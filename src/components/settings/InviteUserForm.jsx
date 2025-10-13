import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MailPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';

const ERROR_MESSAGES = {
  user_already_member: 'המשתמש כבר חבר בארגון.',
  invitation_already_pending: 'כבר קיימת הזמנה פעילה עבור כתובת זו.',
};

const FALLBACK_ERROR = 'שליחת ההזמנה נכשלה. ודא שהכתובת תקינה ונסה שוב.';

export default function InviteUserForm({ orgId }) {
  const { inviteMember } = useOrg();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('יש להזין כתובת דוא"ל.');
      return;
    }
    if (!orgId) {
      toast.error('בחר ארגון לפני שליחת הזמנה.');
      return;
    }

    setIsSubmitting(true);
    try {
      await inviteMember(orgId, trimmedEmail);
      setEmail('');
      toast.success('ההזמנה נשלחה בהצלחה!');
    } catch (error) {
      const apiMessage = error?.message || error?.data?.message;
      const friendlyMessage = ERROR_MESSAGES[apiMessage] || FALLBACK_ERROR;
      toast.error(friendlyMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col md:flex-row gap-3" onSubmit={handleSubmit}>
      <div className="flex-1">
        <label htmlFor="invite-email" className="sr-only">
          כתובת דוא"ל של המוזמן
        </label>
        <Input
          id="invite-email"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="manager@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={isSubmitting}
        />
      </div>
      <Button type="submit" className="gap-2" disabled={isSubmitting}>
        {isSubmitting ? 'שולח...' : (
          <>
            <MailPlus className="w-4 h-4" />
            שלח הזמנה
          </>
        )}
      </Button>
    </form>
  );
}
