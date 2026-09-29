import nodemailer from 'nodemailer';

/**
 * Outbound email.
 *
 * SMTP is optional. This tool runs on an office machine that may well have no
 * mail relay, so when SMTP is not configured the caller gets the link and a
 * mailto: URL and sends it from their own mail client instead. That path is
 * the fallback, not an error — the feature works either way.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function smtpStatus(): { configured: boolean; from: string | null; host: string | null } {
  return {
    configured: smtpConfigured(),
    from: process.env.SMTP_FROM ?? null,
    host: process.env.SMTP_HOST ?? null,
  };
}

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT ?? 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return transport;
}

export async function sendMail(message: MailMessage): Promise<{ sent: boolean; error?: string }> {
  if (!smtpConfigured()) return { sent: false, error: 'SMTP is not configured' };
  try {
    await getTransport().sendMail({
      from: process.env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

/** A mailto: URL the estimator can click when SMTP is not set up. */
export function mailtoUrl(message: MailMessage): string {
  const params = new URLSearchParams({ subject: message.subject, body: message.text });
  return `mailto:${encodeURIComponent(message.to)}?${params.toString()}`;
}
