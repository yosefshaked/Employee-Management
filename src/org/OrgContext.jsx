import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { coreSupabase, OrgSupabaseProvider } from '@/supabaseClient.js';
import { loadRuntimeConfig, MissingRuntimeConfigError } from '@/runtime/config.js';
import { useAuth } from '@/auth/AuthContext.jsx';

const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';
const LEGACY_STORAGE_PREFIX = 'employee-management:last-org';

function maskForDebug(value) {
  if (!value) return '';
  const trimmed = String(value);
  if (trimmed.length <= 4) return '••••';
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
}

function readStoredOrgId(userId) {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    if (!userId) {
      return null;
    }
    const legacyKeyWithUser = `${LEGACY_STORAGE_PREFIX}:${userId}`;
    const legacyValueWithUser = window.localStorage.getItem(legacyKeyWithUser);
    if (legacyValueWithUser) {
      return legacyValueWithUser;
    }
    const legacyFallback = window.localStorage.getItem(LEGACY_STORAGE_PREFIX);
    return legacyFallback;
  } catch {
    return null;
  }
}

function writeStoredOrgId(userId, orgId) {
  if (typeof window === 'undefined') return;
  try {
    if (!orgId) {
      window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
    if (userId) {
      window.localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}:${userId}`);
    }
    window.localStorage.removeItem(LEGACY_STORAGE_PREFIX);
  } catch {
    // ignore storage failures silently
  }
}

const OrgContext = createContext(null);

function normalizeOrgRecord(record) {
  if (!record || !record.organizations) return null;
  const organization = record.organizations;
  const membership = {
    id: record.id,
    org_id: record.org_id,
    role: record.role || 'member',
    user_id: record.user_id,
    created_at: record.created_at,
  };

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug || null,
    supabase_url: organization.supabase_url || '',
    supabase_anon_key: organization.supabase_anon_key || '',
    policy_links: Array.isArray(organization.policy_links) ? organization.policy_links : [],
    legal_settings: organization.legal_settings || {},
    setup_completed: Boolean(organization.setup_completed),
    verified_at: organization.verified_at || null,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
    membership,
  };
}

function normalizeInvite(record) {
  if (!record) return null;
  const organization = record.organizations || record.organization;
  return {
    id: record.id,
    org_id: record.org_id || organization?.id || null,
    email: (record.email || '').toLowerCase(),
    status: record.status || 'pending',
    invited_by: record.invited_by || null,
    created_at: record.created_at,
    expires_at: record.expires_at || null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
        }
      : null,
  };
}

function normalizeMember(record) {
  if (!record) return null;
  const profile = record.profiles || record.profile || record.user_profile || null;
  return {
    id: record.id,
    org_id: record.org_id,
    user_id: record.user_id,
    role: record.role || 'member',
    created_at: record.created_at,
    email: profile?.email || record.email || null,
    name: profile?.full_name || profile?.name || null,
    invited_at: record.invited_at || null,
    joined_at: record.joined_at || record.created_at || null,
    status: record.status || 'active',
  };
}

export function OrgProvider({ children }) {
  const { status: authStatus, user, session } = useAuth();
  const [status, setStatus] = useState('idle');
  const [organizations, setOrganizations] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  const [incomingInvites, setIncomingInvites] = useState([]);
  const [orgMembers, setOrgMembers] = useState([]);
  const [orgInvites, setOrgInvites] = useState([]);
  const [error, setError] = useState(null);
  const [configStatus, setConfigStatus] = useState('idle');
  const [activeOrgConfig, setActiveOrgConfig] = useState(null);
  const loadingRef = useRef(false);
  const lastUserIdRef = useRef(null);
  const configRequestRef = useRef(0);

  const accessToken = session?.access_token || null;

  const resetState = useCallback(() => {
    setStatus('idle');
    setOrganizations([]);
    setActiveOrgId(null);
    setActiveOrg(null);
    setIncomingInvites([]);
    setOrgMembers([]);
    setOrgInvites([]);
    setError(null);
    setActiveOrgConfig(null);
    setConfigStatus('idle');
  }, []);

  const loadMemberships = useCallback(async () => {
    if (!user) {
      resetState();
      return { organizations: [], invites: [] };
    }

    loadingRef.current = true;
    setStatus((prev) => (prev === 'idle' ? 'loading' : prev));
    setError(null);

    try {
      const membershipPromise = coreSupabase
        .from('app_org_memberships')
        .select(
          `id, role, org_id, user_id, created_at,
           organizations:app_organizations (
             id, name, slug, supabase_url, supabase_anon_key,
             policy_links, legal_settings, setup_completed, verified_at,
             created_at, updated_at
           )`,
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      const invitesPromise = user.email
        ? coreSupabase
            .from('app_org_invitations')
            .select(
              `id, org_id, email, status, invited_by, created_at, expires_at,
               organizations:app_organizations (id, name)`,
            )
            .eq('email', user.email.toLowerCase())
            .in('status', ['pending', 'sent'])
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null });

      const [membershipResponse, inviteResponse] = await Promise.all([membershipPromise, invitesPromise]);

      if (membershipResponse.error) throw membershipResponse.error;
      if (inviteResponse.error) throw inviteResponse.error;

      const normalizedOrganizations = (membershipResponse.data || [])
        .map(normalizeOrgRecord)
        .filter(Boolean);

      const normalizedInvites = (inviteResponse.data || []).map(normalizeInvite).filter(Boolean);

      setOrganizations(normalizedOrganizations);
      setIncomingInvites(normalizedInvites);

      return { organizations: normalizedOrganizations, invites: normalizedInvites };
    } catch (loadError) {
      console.error('Failed to load organization memberships', loadError);
      setError(loadError);
      setOrganizations([]);
      setIncomingInvites([]);
      throw loadError;
    } finally {
      loadingRef.current = false;
    }
  }, [user, resetState]);

  const loadOrgDirectory = useCallback(
    async (orgId) => {
      if (!orgId) {
        setOrgMembers([]);
        setOrgInvites([]);
        return;
      }

      try {
        const membersPromise = coreSupabase
          .from('app_org_memberships')
          .select(
            `id, org_id, user_id, role, created_at, invited_at, joined_at, status,
             profiles:app_user_profiles (id, email, full_name)`,
          )
          .eq('org_id', orgId)
          .order('created_at', { ascending: true });

        const invitesPromise = coreSupabase
          .from('app_org_invitations')
          .select('id, org_id, email, status, invited_by, created_at, expires_at')
          .eq('org_id', orgId)
          .in('status', ['pending', 'sent'])
          .order('created_at', { ascending: true });

        const [membersResponse, invitesResponse] = await Promise.all([membersPromise, invitesPromise]);

        if (membersResponse.error) throw membersResponse.error;
        if (invitesResponse.error) throw invitesResponse.error;

        setOrgMembers((membersResponse.data || []).map(normalizeMember).filter(Boolean));
        setOrgInvites((invitesResponse.data || []).map(normalizeInvite).filter(Boolean));
      } catch (directoryError) {
        console.error('Failed to load organization directory', directoryError);
        setOrgMembers([]);
        setOrgInvites([]);
      }
    },
    [],
  );

  const fetchOrgRuntimeConfig = useCallback(
    async (orgId) => {
      if (!orgId) {
        setActiveOrgConfig(null);
        setConfigStatus('idle');
        return;
      }

      if (!accessToken) {
        setConfigStatus('idle');
        return;
      }

      const requestId = configRequestRef.current + 1;
      configRequestRef.current = requestId;
      setConfigStatus('loading');

      try {
        const config = await loadRuntimeConfig({ accessToken, orgId, force: true });

        if (configRequestRef.current !== requestId) {
          return;
        }

        console.info('Loaded organization runtime config', {
          orgId,
          supabaseUrl: maskForDebug(config.supabaseUrl),
          anonKey: maskForDebug(config.supabaseAnonKey),
        });

        setActiveOrgConfig((current) => {
          const normalized = {
            supabaseUrl: config.supabaseUrl,
            supabaseAnonKey: config.supabaseAnonKey,
          };
          if (
            current &&
            current.supabaseUrl === normalized.supabaseUrl &&
            current.supabaseAnonKey === normalized.supabaseAnonKey
          ) {
            return current;
          }
          return normalized;
        });
        setConfigStatus('success');
      } catch (error) {
        if (configRequestRef.current !== requestId) {
          return;
        }

        const message = error instanceof MissingRuntimeConfigError
          ? error.message
          : 'לא ניתן היה לטעון את הגדרות הארגון. נסה שוב בעוד מספר רגעים.';

        console.error('Failed to fetch organization config', error);
        toast.error(message);
        setActiveOrgConfig(null);
        setConfigStatus('error');
      }
    },
    [accessToken],
  );

  const determineStatus = useCallback(
    (orgList) => {
      if (!user) return 'idle';
      if (loadingRef.current) return 'loading';
      if (!orgList.length) return 'needs-org';
      if (!activeOrgId) return 'needs-selection';
      return 'ready';
    },
    [activeOrgId, user],
  );

  const applyActiveOrg = useCallback(
    (org) => {
      if (!org) {
        setActiveOrgId(null);
        setActiveOrg(null);
        setActiveOrgConfig(null);
        setConfigStatus('idle');
        return;
      }

      setActiveOrgId(org.id);
      setActiveOrg(org);

      setActiveOrgConfig(null);
      setConfigStatus('idle');
    },
    [],
  );

  useEffect(() => {
    if (authStatus === 'loading') {
      return;
    }

    if (!user) {
      resetState();
      lastUserIdRef.current = null;
      return;
    }

    if (lastUserIdRef.current !== user.id) {
      lastUserIdRef.current = user.id;
    }

    let isActive = true;

    const initialize = async () => {
      try {
        const { organizations: orgList } = await loadMemberships();
        if (!isActive) return;

        const storedOrgId = readStoredOrgId(user.id);
        const existing = orgList.find((item) => item.id === storedOrgId) || orgList[0] || null;
        if (existing) {
          applyActiveOrg(existing);
          writeStoredOrgId(user?.id ?? null, existing.id);
          await loadOrgDirectory(existing.id);
        } else {
          applyActiveOrg(null);
          setOrgMembers([]);
          setOrgInvites([]);
        }
        setStatus(determineStatus(orgList));
      } catch (initError) {
        if (!isActive) return;
        console.error('Failed to initialize organization context', initError);
        setStatus('error');
      }
    };

    initialize();

    return () => {
      isActive = false;
    };
  }, [authStatus, user, loadMemberships, determineStatus, resetState, applyActiveOrg, loadOrgDirectory]);

  useEffect(() => {
    if (!activeOrgId) return;
    loadOrgDirectory(activeOrgId);
  }, [activeOrgId, loadOrgDirectory]);

  useEffect(() => {
    if (!activeOrgId) return;
    if (!accessToken) {
      setActiveOrgConfig(null);
      return;
    }
    void fetchOrgRuntimeConfig(activeOrgId);
  }, [activeOrgId, accessToken, fetchOrgRuntimeConfig]);

  const selectOrg = useCallback(
    async (orgId) => {
      if (!orgId) {
        applyActiveOrg(null);
        writeStoredOrgId(user?.id ?? null, '');
        setStatus(determineStatus(organizations));
        return;
      }

      const next = organizations.find((org) => org.id === orgId);
      if (!next) {
        toast.error('הארגון שנבחר אינו זמין.');
        return;
      }

      applyActiveOrg(next);
      writeStoredOrgId(user?.id ?? null, orgId);
      await loadOrgDirectory(orgId);
      setStatus(determineStatus(organizations));
    },
    [organizations, user, determineStatus, applyActiveOrg, loadOrgDirectory],
  );

  const refreshOrganizations = useCallback(
    async ({ keepSelection = true } = {}) => {
      if (!user) return;
      const previousOrgId = keepSelection ? activeOrgId : null;
      const { organizations: orgList } = await loadMemberships();
      const nextActive = keepSelection && previousOrgId
        ? orgList.find((org) => org.id === previousOrgId)
        : orgList[0] || null;

      if (nextActive) {
        applyActiveOrg(nextActive);
        writeStoredOrgId(user?.id ?? null, nextActive.id);
        await loadOrgDirectory(nextActive.id);
      } else {
        applyActiveOrg(null);
        setOrgMembers([]);
        setOrgInvites([]);
      }
      setStatus(determineStatus(orgList));
    },
    [user, activeOrgId, loadMemberships, applyActiveOrg, loadOrgDirectory, determineStatus],
  );

  const syncOrgSettings = useCallback(
    async (orgId, supabaseUrl, supabaseAnonKey) => {
      if (!orgId) throw new Error('זיהוי ארגון חסר.');
      const normalizedUrl = supabaseUrl ? supabaseUrl.trim() : '';
      const normalizedKey = supabaseAnonKey ? supabaseAnonKey.trim() : '';

      if (!normalizedUrl || !normalizedKey) {
        const { error } = await coreSupabase
          .from('org_settings')
          .delete()
          .eq('org_id', orgId);
        if (error) throw error;
        return;
      }

      const payload = {
        org_id: orgId,
        supabase_url: normalizedUrl,
        anon_key: normalizedKey,
        updated_at: new Date().toISOString(),
      };

      const { error } = await coreSupabase
        .from('org_settings')
        .upsert(payload, { onConflict: 'org_id' });
      if (error) throw error;
    },
    [],
  );

  const createOrganization = useCallback(
    async ({ name, supabaseUrl, supabaseAnonKey, policyLinks = [], legalSettings = {} }) => {
      if (!user) throw new Error('אין משתמש מחובר.');
      if (!accessToken) throw new Error('חיבור אימות חסר. היכנס מחדש.');

      const trimmedName = (name || '').trim();
      if (!trimmedName) throw new Error('יש להזין שם ארגון.');

      const payload = { name: trimmedName };

      if (typeof supabaseUrl === 'string' && supabaseUrl.trim()) {
        payload.supabaseUrl = supabaseUrl.trim();
      }

      if (typeof supabaseAnonKey === 'string' && supabaseAnonKey.trim()) {
        payload.supabaseAnonKey = supabaseAnonKey.trim();
      }

      if (Array.isArray(policyLinks)) {
        payload.policyLinks = policyLinks
          .map((item) => {
            if (!item) return '';
            if (typeof item === 'string') return item.trim();
            if (typeof item.url === 'string') return item.url.trim();
            if (typeof item.href === 'string') return item.href.trim();
            return '';
          })
          .filter(Boolean);
      }

      if (legalSettings && typeof legalSettings === 'object' && !Array.isArray(legalSettings)) {
        payload.legalSettings = legalSettings;
      }

      let response;
      try {
        response = await fetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (networkError) {
        console.error('Failed to reach organization creation API', networkError);
        throw new Error('יצירת הארגון נכשלה. בדוק את החיבור לרשת ונסה שוב.');
      }

      let body;
      try {
        body = await response.json();
      } catch (parseError) {
        console.error('Organization creation API returned a non-JSON response', parseError);
        throw new Error('שרת ה-API החזיר תגובה שגויה בעת יצירת הארגון.');
      }

      if (!response.ok) {
        console.error('Organization creation API responded with an error', {
          status: response.status,
          body,
        });
        const message = typeof body?.message === 'string'
          ? body.message
          : 'יצירת הארגון נכשלה. נסה שוב.';
        throw new Error(message);
      }

      const orgId = body?.id || null;

      await refreshOrganizations({ keepSelection: false });
      if (orgId) {
        await selectOrg(orgId);
      }
      toast.success('הארגון נוצר בהצלחה.');
    },
    [user, accessToken, refreshOrganizations, selectOrg],
  );

  const updateOrganizationMetadata = useCallback(
    async (orgId, updates) => {
      if (!orgId) throw new Error('זיהוי ארגון חסר.');
      const payload = { ...updates, updated_at: new Date().toISOString() };
      const { error } = await coreSupabase
        .from('app_organizations')
        .update(payload)
        .eq('id', orgId);
      if (error) throw error;
      await refreshOrganizations();
    },
    [refreshOrganizations],
  );

  const updateConnection = useCallback(
    async (orgId, { supabaseUrl, supabaseAnonKey, policyLinks, legalSettings }) => {
      const updates = {
        supabase_url: supabaseUrl ? supabaseUrl.trim() : null,
        supabase_anon_key: supabaseAnonKey ? supabaseAnonKey.trim() : null,
      };
      if (Array.isArray(policyLinks)) {
        updates.policy_links = policyLinks;
      }
      if (legalSettings && typeof legalSettings === 'object') {
        updates.legal_settings = legalSettings;
      }
      await updateOrganizationMetadata(orgId, updates);
      await syncOrgSettings(orgId, supabaseUrl, supabaseAnonKey);
    },
    [updateOrganizationMetadata, syncOrgSettings],
  );

  const recordVerification = useCallback(
    async (orgId, verifiedAt) => {
      await updateOrganizationMetadata(orgId, {
        setup_completed: true,
        verified_at: verifiedAt,
      });
    },
    [updateOrganizationMetadata],
  );

  const inviteMember = useCallback(
    async (orgId, email) => {
      if (!orgId) throw new Error('יש לבחור ארגון להזמנה.');
      const normalizedEmail = (email || '').trim().toLowerCase();
      if (!normalizedEmail) throw new Error('יש להזין כתובת אימייל תקינה.');

      const { data, error } = await coreSupabase
        .from('app_org_invitations')
        .insert({
          org_id: orgId,
          email: normalizedEmail,
          status: 'pending',
          invited_by: user?.id || null,
        })
        .select('id')
        .single();

      if (error) throw error;
      await loadOrgDirectory(orgId);
      toast.success('הזמנה נשלחה.');
      return data;
    },
    [user, loadOrgDirectory],
  );

  const revokeInvite = useCallback(
    async (inviteId) => {
      if (!inviteId) return;
      const { error } = await coreSupabase
        .from('app_org_invitations')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error) throw error;
      if (activeOrgId) await loadOrgDirectory(activeOrgId);
    },
    [activeOrgId, loadOrgDirectory],
  );

  const removeMember = useCallback(
    async (membershipId) => {
      if (!membershipId) return;
      const { error } = await coreSupabase
        .from('app_org_memberships')
        .delete()
        .eq('id', membershipId);
      if (error) throw error;
      if (activeOrgId) {
        await loadOrgDirectory(activeOrgId);
        await refreshOrganizations();
      }
    },
    [activeOrgId, loadOrgDirectory, refreshOrganizations],
  );

  const acceptInvite = useCallback(
    async (inviteId) => {
      if (!inviteId || !user) throw new Error('הזמנה אינה זמינה.');

      const { data: inviteData, error: inviteError } = await coreSupabase
        .from('app_org_invitations')
        .select('id, org_id, status')
        .eq('id', inviteId)
        .maybeSingle();

      if (inviteError) throw inviteError;
      if (!inviteData) throw new Error('ההזמנה אינה קיימת או פגה.');

      if (inviteData.status !== 'pending' && inviteData.status !== 'sent') {
        throw new Error('ההזמנה כבר טופלה.');
      }

      const now = new Date().toISOString();

      const { error: membershipError } = await coreSupabase
        .from('app_org_memberships')
        .insert({
          org_id: inviteData.org_id,
          user_id: user.id,
          role: 'member',
          created_at: now,
        });

      if (membershipError && membershipError.code !== '23505') {
        throw membershipError;
      }

      const { error: updateError } = await coreSupabase
        .from('app_org_invitations')
        .update({ status: 'accepted', accepted_at: now })
        .eq('id', inviteId);

      if (updateError) throw updateError;

      await refreshOrganizations({ keepSelection: false });
      await selectOrg(inviteData.org_id);
      toast.success('הצטרפת לארגון בהצלחה.');
    },
    [user, refreshOrganizations, selectOrg],
  );

  const value = useMemo(
    () => ({
      status,
      error,
      organizations,
      activeOrg,
      activeOrgId,
      incomingInvites,
      members: orgMembers,
      pendingInvites: orgInvites,
      selectOrg,
      refreshOrganizations,
      createOrganization,
      updateOrganizationMetadata,
      updateConnection,
      recordVerification,
      inviteMember,
      revokeInvite,
      removeMember,
      acceptInvite,
      activeOrgHasConnection: Boolean(activeOrg?.supabase_url && activeOrg?.supabase_anon_key),
      activeOrgConfig,
      configStatus,
    }),
    [
      status,
      error,
      organizations,
      activeOrg,
      activeOrgId,
      incomingInvites,
      orgMembers,
      orgInvites,
      selectOrg,
      refreshOrganizations,
      createOrganization,
      updateOrganizationMetadata,
      updateConnection,
      recordVerification,
      inviteMember,
      revokeInvite,
      removeMember,
      acceptInvite,
      configStatus,
      activeOrgConfig,
    ],
  );

  return (
    <OrgSupabaseProvider config={activeOrgConfig}>
      <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
    </OrgSupabaseProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}
