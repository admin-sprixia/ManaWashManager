import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { NetworkError } from '../../api/network';

type Purpose = 'signup' | 'join';

interface CodeBody {
  sent?: boolean;
  ticket?: string;
  error?: string;
  message?: string;
  retryAfter?: number;
  resendAfter?: number;
  attemptsLeft?: number;
}

export function describeError(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof NetworkError) return 'No connection. Check mobile data or Wi-Fi and try again.';
  return e instanceof Error ? e.message : fallback;
}

/**
 * WhatsApp code for a number without an account. `request` sends (or re-shows a code sent moments
 * ago); `verify` resolves to the ticket for the next step, or null with `error` set.
 */
export function useSignupCode(phone: string, purpose: Purpose) {
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /** True once a code is on its way (or one sent moments ago is still good). */
  const request = async (): Promise<boolean> => {
    if (sending) return false;
    setError(null);
    setSending(true);
    try {
      const res = await api.signup.code.$post({ json: { phone, purpose } });
      const body = (await res.json().catch(() => null)) as CodeBody | null;
      if (body?.error === 'too_soon') {
        setResendIn(body.retryAfter ?? 30);
        return true;
      }
      if (!res.ok) throw new Error(body?.message ?? 'Couldn’t send the code.');
      setResendIn(body?.resendAfter ?? 30);
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  const verify = async (value: string): Promise<string | null> => {
    if (checking) return null;
    setError(null);
    setChecking(true);
    try {
      const res = await api.signup.verify.$post({ json: { phone, purpose, code: value } });
      const body = (await res.json().catch(() => null)) as CodeBody | null;
      if (!res.ok || !body?.ticket) {
        setCode('');
        throw new Error(
          body?.attemptsLeft != null
            ? `${body.message ?? 'That code isn’t right.'} ${body.attemptsLeft} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
            : (body?.message ?? 'Couldn’t check the code.'),
        );
      }
      return body.ticket;
    } catch (e) {
      setError(describeError(e));
      return null;
    } finally {
      setChecking(false);
    }
  };

  return { code, setCode, sending, checking, error, setError, resendIn, request, verify };
}
