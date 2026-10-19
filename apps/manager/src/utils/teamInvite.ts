import { USER_ROLE_LABEL, type UserRole } from '@mana/domain';
import { PARTNER_APP_LINK } from '../config/app';
import { openWhatsApp } from './whatsapp';

/** Who the WhatsApp invite is for. */
export interface Invitee {
  name: string;
  phone: string;
  role: UserRole;
  /** Already signs in at another branch, with a PIN of their own. */
  hasPin: boolean;
  /** Mana Wash HQ who work at no branch: the invite is to HQ, not to a branch team. */
  hq?: boolean;
}

const spaced = (phone: string) => (phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone);

/**
 * The message sent from the adder's own phone: how to install the app and get in. The WhatsApp
 * code and the PIN happen on the new person's phone; nobody else ever sees their PIN.
 */
export function inviteMessage(a: Invitee, branch: string | null): string {
  const first = a.name.split(/\s+/)[0] ?? a.name;
  const at = branch ? `the ${branch} team` : 'the team';
  const hello = a.hq
    ? `Hi ${first}, I’ve added you to Mana Wash HQ. You’ll look after services, prices and every branch.`
    : `Hi ${first}, I’ve added you to ${at} at Sri Mana Wash as ${USER_ROLE_LABEL[a.role]}.`;
  if (a.hasPin && a.hq) {
    return [hello, 'Open Sri Mana Wash Partner and sign in with your number and your usual PIN.'].join('\n\n');
  }
  if (a.hasPin) {
    return [
      hello,
      `Open Sri Mana Wash Partner and sign in with your number and your usual PIN, then pick ${branch ?? 'this branch'} at the top of the home screen.`,
    ].join('\n\n');
  }
  return [
    hello,
    '',
    `1. Install the Sri Mana Wash Partner app: ${PARTNER_APP_LINK}`,
    `2. Open it and type this number: +91 ${spaced(a.phone)}`,
    '3. Type the code it sends you on WhatsApp.',
    '4. Choose your own PIN. Don’t share it with anyone, not even me.',
  ].join('\n');
}

/** Opens WhatsApp on this phone with the invite typed in; false when WhatsApp couldn't open. */
export function sendInvite(a: Invitee, branch: string | null): Promise<boolean> {
  return openWhatsApp(a.phone, inviteMessage(a, branch));
}
