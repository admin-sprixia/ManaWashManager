export interface OtpProvider {
  sendOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, code: string): Promise<boolean>;
}

/**
 * MSG91-backed OTP provider — MSG91 generates and verifies the code on their side (an OTP API
 * product, not a raw SMS send), so this wraps their REST API rather than storing codes locally.
 * Docs: https://docs.msg91.com/
 */
export class Msg91OtpProvider implements OtpProvider {
  constructor(private readonly apiKey: string) {}

  async sendOtp(phone: string): Promise<void> {
    const res = await fetch(
      `https://control.msg91.com/api/v5/otp?mobile=${encodeURIComponent(phone)}`,
      { method: 'POST', headers: { authkey: this.apiKey } },
    );
    if (!res.ok) {
      throw new Error(`MSG91 sendOtp failed: ${res.status} ${await res.text()}`);
    }
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const res = await fetch(
      `https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(phone)}&otp=${encodeURIComponent(code)}`,
      { headers: { authkey: this.apiKey } },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { type?: string };
    return body.type === 'success';
  }
}
