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
import {
  coreSupabase,
  OrgSupabaseProvider,
  maskSupabaseCredential,
  subscribeOrgClientChange,
} from '@/supabaseClient.js';
import { loadRuntimeConfig, MissingRuntimeConfigError } from '@/runtime/config.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { createOrganization as createOrganizationRpc } from '@/api/organizations.js';
import { mapSupabaseError } from '@/org/errors.js';
import { fetchCurrentUser } from '@/shared/api/user.ts';

const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';
const LEGACY_STORAGE_PREFIX = 'employee-management:last-org';

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

function normalizeOrgRecord(record, organizationOverride, connectionOverride) {
  if (!record) return null;
  const organization = organizationOverride || record.organizations;
  if (!organization) return null;
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
    policy_links: Array.isArray(organization.policy_links) ? organization.policy_links : [],
    legal_settings: organization.legal_settings || {},
    setup_completed: Boolean(organization.setup_completed),
    verified_at: organization.verified_at || null,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
    has_connection: Boolean(
      connectionOverride?.supabaseUrl && connectionOverride?.supabaseAnonKey,
    ),
    membership,
  };
}

function normalizeInvite(record, organizationOverride) {
  if (!record) return null;
  const organization = organizationOverride || record.organizations || record.organization;
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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deriveNameFromMetadata(metadata) {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const trimmedFullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
  if (trimmedFullName) {
    return trimmedFullName;
  }

  const trimmedName = typeof metadata.name === 'string' ? metadata.name.trim() : '';
  if (trimmedName) {
    return trimmedName;
  }

  const given = typeof metadata.given_name === 'string' ? metadata.given_name.trim() : '';
  const family = typeof metadata.family_name === 'string' ? metadata.family_name.trim() : '';
  const combined = [given, family].filter(Boolean).join(' ');
  if (combined) {
    return combined;
  }

  const preferred = typeof metadata.preferred_username === 'string' ? metadata.preferred_username.trim() : '';
  if (preferred) {
    return preferred;
  }

  return null;
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
  const [orgConnections, setOrgConnections] = useState(new Map());
  const [error, setError] = useState(null);
  const [configStatus, setConfigStatus] = useState('idle');
  const [activeOrgConfig, setActiveOrgConfig] = useState(null);
  const [tenantClientReady, setTenantClientReady] = useState(false);
  const loadingRef = useRef(false);
  const lastUserIdRef = useRef(null);
  const configRequestRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeOrgClientChange((client) => {
      setTenantClientReady(Boolean(client));
    });
    return unsubscribe;
  }, []);

  const resetState = useCallback(() => {
    setStatus('idle');
    setOrganizations([]);
    setActiveOrgId(null);
    setActiveOrg(null);
    setIncomingInvites([]);
    setOrgMembers([]);
    setOrgInvites([]);
    setOrgConnections(new Map());
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
        .from('org_memberships')
        .select('id, role, org_id, user_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      const invitesPromise = user.email
        ? coreSupabase
            .from('org_invitations')
            .select('id, org_id, email, status, invited_by, created_at, expires_at')
            .eq('email', user.email.toLowerCase())
            .in('status', ['pending', 'sent'])
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null });

      const [membershipResponse, inviteResponse] = await Promise.all([membershipPromise, invitesPromise]);

      if (membershipResponse.error) throw membershipResponse.error;
      if (inviteResponse.error) throw inviteResponse.error;

      const membershipData = membershipResponse.data || [];
      const inviteData = inviteResponse.data || [];

      const orgIds = Array.from(
        new Set([
          ...membershipData.map((record) => record.org_id).filter(Boolean),
          ...inviteData.map((record) => record.org_id).filter(Boolean),
        ]),
      );

      let organizationMap = null;
      const connectionMap = new Map();

      if (orgIds.length) {
        const { data: organizationsData, error: organizationsError } = await coreSupabase
          .from('organizations')
          .select(
            'id, name, slug, policy_links, legal_settings, setup_completed, verified_at, created_at, updated_at',
          )
          .in('id', orgIds);

        if (organizationsError) throw organizationsError;

        organizationMap = new Map((organizationsData || []).map((org) => [org.id, org]));
      }

      let normalizedOrganizations = membershipData
        .map((membership) =>
          normalizeOrgRecord(
            membership,
            organizationMap?.get(membership.org_id),
            connectionMap.get(membership.org_id),
          ),
        )
        .filter(Boolean);

      if (orgIds.length) {
        const { data: settingsData, error: settingsError } = await coreSupabase
          .from('org_settings')
          .select('org_id, supabase_url, anon_key, metadata, updated_at')
          .in('org_id', orgIds);

        if (settingsError) {
          console.warn('Failed to load org settings snapshot', settingsError);
        } else if (settingsData?.length) {
          settingsData.forEach((item) => {
            connectionMap.set(item.org_id, {
              supabaseUrl: item.supabase_url || '',
              supabaseAnonKey: item.anon_key || '',
              metadata: item.metadata || null,
              updatedAt: item.updated_at || null,
            });
          });

          normalizedOrganizations = normalizedOrganizations.map((org) => {
            const settings = connectionMap.get(org.id);
            if (!settings) return org;
            return {
              ...org,
              has_connection: Boolean(settings.supabaseUrl && settings.supabaseAnonKey),
              org_settings_metadata: settings.metadata,
              org_settings_updated_at: settings.updatedAt,
            };
          });
        }
      }

      setOrgConnections(connectionMap);

      const normalizedInvites = inviteData
        .map((invite) => normalizeInvite(invite, organizationMap?.get(invite.org_id)))
        .filter(Boolean);

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
        const [membersResponse, invitesResponse] = await Promise.all([
          coreSupabase
            .from('org_memberships')
            .select('id, org_id, user_id, role, created_at')
            .eq('org_id', orgId)
            .order('created_at', { ascending: true }),
          coreSupabase
            .from('org_invitations')
            .select('id, org_id, email, status, invited_by, created_at, expires_at')
            .eq('org_id', orgId)
            .in('status', ['pending', 'sent'])
            .order('created_at', { ascending: true }),
        ]);

        if (membersResponse.error) throw membersResponse.error;
        if (invitesResponse.error) throw invitesResponse.error;

        const membersData = membersResponse.data || [];
        const userIds = membersData.map((member) => member.user_id).filter(Boolean);
        const profileMap = new Map();

        if (userIds.length) {
          const idSet = new Set(userIds);
          const accessToken = session?.access_token || null;

          if (accessToken) {
            try {
              const currentProfile = await fetchCurrentUser({ accessToken });
              if (currentProfile?.id && idSet.has(currentProfile.id)) {
                const metadata = currentProfile.raw_user_meta_data;
                const derivedName = deriveNameFromMetadata(metadata) || currentProfile.email || null;

                profileMap.set(currentProfile.id, {
                  id: currentProfile.id,
                  email: currentProfile.email || null,
                  full_name: derivedName,
                  name: derivedName,
                });
              }
            } catch (profileError) {
              console.warn('Failed to load current user profile via /api/users/me', profileError);
            }
          } else {
            console.warn('Skipped /api/users/me profile fetch due to missing access token.');
          }
        }

        const normalizedMembers = membersData
          .map((member) => {
            const profile = profileMap.get(member.user_id);
            if (profile) {
              return normalizeMember({
                ...member,
                profile,
                profiles: profile,
                user_profile: profile,
              });
            }
            return normalizeMember(member);
          })
          .filter(Boolean);

        setOrgMembers(normalizedMembers);
        setOrgInvites((invitesResponse.data || []).map((invite) => normalizeInvite(invite)).filter(Boolean));
      } catch (directoryError) {
        console.error('Failed to load organization directory', directoryError);
        setOrgMembers([]);
        setOrgInvites([]);
      }
    },
    [session],
  );

  const fetchOrgRuntimeConfig = useCallback(async (orgId) => {
    if (!orgId) {
      setActiveOrgConfig(null);
      setConfigStatus('idle');
      return;
    }

    const requestId = configRequestRef.current + 1;
    configRequestRef.current = requestId;
    setConfigStatus('loading');

    try {
      const { data: sessionData, error: sessionError } = await coreSupabase.auth.getSession();

      if (configRequestRef.current !== requestId) {
        return;
      }

      if (sessionError) {
        const authError = new MissingRuntimeConfigError('פג תוקף כניסה/חסר Bearer');
        authError.status = 401;
        authError.cause = sessionError;
        throw authError;
      }

      const accessToken = sessionData?.session?.access_token || null;

      if (!accessToken) {
        const missingTokenError = new MissingRuntimeConfigError('פג תוקף כניסה/חסר Bearer');
        missingTokenError.status = 401;
        throw missingTokenError;
      }

      const config = await loadRuntimeConfig({ accessToken, orgId, force: true });

      if (configRequestRef.current !== requestId) {
        return;
      }

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
      console.info('[OrgSupabase]', {
        action: 'config-fetched',
        orgId,
        supabaseUrl: maskSupabaseCredential(config.supabaseUrl),
        anonKey: maskSupabaseCredential(config.supabaseAnonKey),
        source: config.source || 'unknown',
      });
    } catch (error) {
      if (configRequestRef.current !== requestId) {
        return;
      }

      console.error('Failed to fetch organization config', error);

      if (error?.status === 401) {
        toast.error('פג תוקף כניסה/חסר Bearer');
        try {
          await coreSupabase.auth.refreshSession();
        } catch (refreshError) {
          console.error('Failed to refresh Supabase session after 401', refreshError);
        }
      } else if (error?.status === 404) {
        toast.error('לא נמצא ארגון או שאין הרשאה');
      } else if (typeof error?.status === 'number' && error.status >= 500) {
        toast.error('שגיאת שרת בעת טעינת מפתחות הארגון.');
      } else if (error instanceof MissingRuntimeConfigError) {
        toast.error(error.message);
      } else {
        toast.error('לא ניתן היה לטעון את הגדרות הארגון. נסה שוב בעוד מספר רגעים.');
      }

      setActiveOrgConfig(null);
      setConfigStatus('error');
    }
  }, []);

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
    void fetchOrgRuntimeConfig(activeOrgId);
  }, [activeOrgId, fetchOrgRuntimeConfig]);

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
        setOrgConnections((prev) => {
          const next = new Map(prev);
          next.delete(orgId);
          return next;
        });
        setOrganizations((prev) =>
          prev.map((org) =>
            org.id === orgId
              ? {
                  ...org,
                  has_connection: false,
                  org_settings_metadata: null,
                  org_settings_updated_at: null,
                }
              : org,
          ),
        );
        if (orgId === activeOrgId) {
          setActiveOrg((current) => {
            if (!current || current.id !== orgId) return current;
            return {
              ...current,
              has_connection: false,
              org_settings_metadata: null,
              org_settings_updated_at: null,
            };
          });
        }
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
      setOrgConnections((prev) => {
        const next = new Map(prev);
        const previous = prev.get(orgId);
        next.set(orgId, {
          supabaseUrl: normalizedUrl,
          supabaseAnonKey: normalizedKey,
          metadata: previous?.metadata ?? null,
          updatedAt: payload.updated_at,
        });
        return next;
      });
      setOrganizations((prev) =>
        prev.map((org) =>
          org.id === orgId
            ? {
                ...org,
                has_connection: Boolean(normalizedUrl && normalizedKey),
                org_settings_metadata: org.org_settings_metadata ?? null,
                org_settings_updated_at: payload.updated_at,
              }
            : org,
        ),
      );
      if (orgId === activeOrgId) {
        setActiveOrg((current) => {
          if (!current || current.id !== orgId) return current;
          return {
            ...current,
            has_connection: Boolean(normalizedUrl && normalizedKey),
            org_settings_metadata: current.org_settings_metadata ?? null,
            org_settings_updated_at: payload.updated_at,
          };
        });
      }
    },
    [activeOrgId],
  );

  const createOrganization = useCallback(
    async ({ name, supabaseUrl, supabaseAnonKey, policyLinks = [], legalSettings = {} }) => {
      if (!user?.id && !session?.user?.id) {
        const { data: authUser, error: authError } = await coreSupabase.auth.getUser();
        if (authError) {
          console.error('Failed to resolve authenticated user for organization creation', authError);
          throw new Error('לא ניתן היה לאמת את המשתמש. נסה להתחבר מחדש.');
        }

        if (!authUser?.user?.id) {
          throw new Error('אין משתמש מחובר.');
        }
      }

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        throw new Error('יש להזין שם ארגון.');
      }

      const payload = {};

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

      const now = new Date().toISOString();

      try {
        const effectiveOrgId = await createOrganizationRpc(trimmedName);

        const updates = {};

        if (Object.prototype.hasOwnProperty.call(payload, 'supabaseUrl')) {
          updates.supabase_url = payload.supabaseUrl || null;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'supabaseAnonKey')) {
          updates.supabase_anon_key = payload.supabaseAnonKey || null;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'policyLinks')) {
          updates.policy_links = payload.policyLinks || [];
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'legalSettings')) {
          updates.legal_settings = payload.legalSettings || {};
        }

        if (Object.keys(updates).length) {
          updates.updated_at = now;

          const { error: updateError } = await coreSupabase
            .from('organizations')
            .update(updates)
            .eq('id', effectiveOrgId);

          if (updateError) {
            console.error('Failed to update organization metadata after creation', updateError);
            throw updateError;
          }
        }

        await syncOrgSettings(effectiveOrgId, payload.supabaseUrl, payload.supabaseAnonKey);

        await refreshOrganizations({ keepSelection: false });
        await selectOrg(effectiveOrgId);
        toast.success('הארגון נוצר בהצלחה.');
        return effectiveOrgId;
      } catch (error) {
        console.error('Failed to create organization', error);
        const message = mapSupabaseError(error);
        throw new Error(message);
      }
    },
    [user, session, refreshOrganizations, selectOrg, syncOrgSettings],
  );

  const updateOrganizationMetadata = useCallback(
    async (orgId, updates) => {
      if (!orgId) throw new Error('זיהוי ארגון חסר.');
      const payload = { ...updates, updated_at: new Date().toISOString() };
      const { error } = await coreSupabase
        .from('organizations')
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
      if (orgId && orgId === activeOrgId) {
        await fetchOrgRuntimeConfig(orgId);
      }
    },
    [updateOrganizationMetadata, syncOrgSettings, activeOrgId, fetchOrgRuntimeConfig],
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
        .from('org_invitations')
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
        .from('org_invitations')
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
        .from('org_memberships')
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
        .from('org_invitations')
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
        .from('org_memberships')
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
        .from('org_invitations')
        .update({ status: 'accepted', accepted_at: now })
        .eq('id', inviteId);

      if (updateError) throw updateError;

      await refreshOrganizations({ keepSelection: false });
      await selectOrg(inviteData.org_id);
      toast.success('הצטרפת לארגון בהצלחה.');
    },
    [user, refreshOrganizations, selectOrg],
  );

  const activeOrgConnection = useMemo(() => {
    if (!activeOrgId) return null;
    const connection = orgConnections.get(activeOrgId);
    if (!connection) return null;
    return connection;
  }, [activeOrgId, orgConnections]);

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
      activeOrgHasConnection: Boolean(
        (activeOrgConnection?.supabaseUrl || activeOrgConfig?.supabaseUrl) &&
          (activeOrgConnection?.supabaseAnonKey || activeOrgConfig?.supabaseAnonKey),
      ),
      activeOrgConfig,
      configStatus,
      activeOrgConnection,
      tenantClientReady,
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
      activeOrgConnection,
      tenantClientReady,
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
