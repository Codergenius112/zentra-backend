import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as QRCode from 'qrcode';

interface ReceiptEmailPayload {
  customerName?: string;
  bookingId: string;
  amount: number;
  currency?: string;
  reference?: string;
  status?: string;
  createdAt?: Date;
}

interface TicketQrEmailPayload {
  customerName?: string;
  bookingId: string;
  eventId?: string;
  guestCount?: number;
  qrCodeDataUrl: string;
}

interface PasswordResetEmailPayload {
  customerName?: string;
  resetToken: string;
  expiresInMinutes?: number;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  private getConfig(key: string, fallback?: string): string | undefined {
    return this.configService.get<string>(key) ?? fallback;
  }

  async generateTicketQrDataUrl(payload: Record<string, unknown> | string): Promise<string> {
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload);

    return QRCode.toDataURL(value, {
      type: 'image/png',
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  }

  buildReceiptHtml(payload: ReceiptEmailPayload): string {
    const appName = this.getConfig('APP_NAME', 'Zentra') ?? 'Zentra';
    const amount = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: payload.currency ?? 'NGN',
      minimumFractionDigits: 2,
    }).format(Number(payload.amount ?? 0));

    const createdAt = payload.createdAt
      ? new Intl.DateTimeFormat('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(payload.createdAt))
      : 'N/A';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <div style="background: #0f172a; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="margin: 0; font-size: 28px;">${appName}</h2>
          <p style="margin: 8px 0 0; opacity: 0.9;">Purchase receipt</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #ffffff;">
          <p style="margin: 0 0 16px;">Hello ${payload.customerName ?? 'Customer'},</p>
          <p style="margin: 0 0 24px;">Your payment has been received successfully.</p>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px 0; color: #6b7280;">Booking ID</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 600;">${payload.bookingId}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px 0; color: #6b7280;">Reference</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 600;">${payload.reference ?? 'N/A'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px 0; color: #6b7280;">Amount</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 600;">${amount}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px 0; color: #6b7280;">Date</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 600;">${createdAt}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #6b7280;">Status</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #15803d;">${payload.status ?? 'PAID'}</td>
            </tr>
          </table>

          <p style="margin: 0; color: #374151;">Thank you for choosing ${appName}.</p>
        </div>
      </div>
    `;
  }

  async sendReceiptEmail(payload: ReceiptEmailPayload & { to: string }): Promise<boolean> {
    const to = payload.to;
    const subject = `Your ${this.getConfig('APP_NAME', 'Zentra') ?? 'Zentra'} payment receipt`;
    const html = this.buildReceiptHtml(payload);

    return this.sendEmail({
      to,
      subject,
      html,
      text: `Your payment receipt for booking ${payload.bookingId} has been generated successfully.`,
    });
  }

  async sendTicketQrEmail(payload: TicketQrEmailPayload & { to: string }): Promise<boolean> {
    const to = payload.to;
    const subject = `Your ${this.getConfig('APP_NAME', 'Zentra') ?? 'Zentra'} ticket QR code`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <div style="background: linear-gradient(135deg, #0f172a, #1d4ed8); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="margin: 0; font-size: 28px;">Your ticket is ready</h2>
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #ffffff;">
          <p style="margin: 0 0 16px;">Hello ${payload.customerName ?? 'Customer'},</p>
          <p style="margin: 0 0 20px;">Your ticket for booking <strong>${payload.bookingId}</strong> is attached below.</p>

          <div style="text-align: center; margin: 20px 0;">
            <img src="${payload.qrCodeDataUrl}" alt="Ticket QR code" style="max-width: 220px; width: 100%; border: 1px solid #d1d5db; border-radius: 12px; background: white; padding: 12px;" />
          </div>

          <p style="margin: 0 0 8px; color: #374151;">Booking ID: <strong>${payload.bookingId}</strong></p>
          <p style="margin: 0 0 8px; color: #374151;">Event ID: <strong>${payload.eventId ?? 'N/A'}</strong></p>
          <p style="margin: 0; color: #374151;">Guests: <strong>${payload.guestCount ?? 1}</strong></p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to,
      subject,
      html,
      text: `Your ticket QR code is ready for booking ${payload.bookingId}.`,
    });
  }

  async sendPasswordResetEmail(payload: PasswordResetEmailPayload & { to: string }): Promise<boolean> {
    const to = payload.to;
    const appName = this.getConfig('APP_NAME', 'Zentra') ?? 'Zentra';
    const subject = `Reset your ${appName} password`;
    const minutes = payload.expiresInMinutes ?? 15;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <div style="background: #0f172a; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="margin: 0; font-size: 28px;">${appName}</h2>
          <p style="margin: 8px 0 0; opacity: 0.9;">Password reset request</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #ffffff;">
          <p style="margin: 0 0 16px;">Hello ${payload.customerName ?? 'there'},</p>
          <p style="margin: 0 0 20px;">Enter this code in the app to reset your password. It expires in ${minutes} minutes.</p>

          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-family: 'Courier New', monospace; font-size: 22px; font-weight: 700; letter-spacing: 2px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 10px; padding: 14px 20px; word-break: break-all;">
              ${payload.resetToken}
            </span>
          </div>

          <p style="margin: 0; color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to,
      subject,
      html,
      text: `Your ${appName} password reset code is: ${payload.resetToken} (expires in ${minutes} minutes). If you didn't request this, ignore this email.`,
    });
  }

  private async sendEmail({
    to,
    subject,
    html,
    text,
  }: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<boolean> {
    const fromName = this.getConfig('EMAIL_FROM_NAME', 'Zentra');
    const fromAddress = this.getConfig('EMAIL_FROM', 'noreply@zentra.app');
    const provider = this.getConfig('EMAIL_PROVIDER', 'smtp')?.toLowerCase();
    const smtpHost = this.getConfig('SMTP_HOST') ?? (provider === 'resend' ? 'smtp.resend.com' : undefined);
    const smtpPort = Number(this.getConfig('SMTP_PORT') ?? (provider === 'resend' ? '587' : '587'));
    const smtpUser = this.getConfig('SMTP_USER') ?? (provider === 'resend' ? 'resend' : undefined);
    const smtpPass = this.getConfig('SMTP_PASS') ?? this.getConfig('RESEND_API_KEY') ?? this.getConfig('SENDGRID_API_KEY');

    if (!to || !subject) {
      this.logger.warn('Email skipped because recipient or subject is missing.');
      return false;
    }

    const isSendgridProvider = provider === 'sendgrid';
    const isResendProvider = provider === 'resend';
    const hasExplicitResendKey = !!this.getConfig('RESEND_API_KEY');
    const hasExplicitSendgridKey = !!this.getConfig('SENDGRID_API_KEY');

    if (isSendgridProvider || isResendProvider || (!smtpHost && !smtpUser && !smtpPass && hasExplicitSendgridKey)) {
      const host = smtpHost ?? (isResendProvider ? 'smtp.resend.com' : 'smtp.sendgrid.net');
      const user = smtpUser ?? (isResendProvider ? 'resend' : 'apikey');
      const pass = smtpPass ?? (isResendProvider ? this.getConfig('RESEND_API_KEY') : this.getConfig('SENDGRID_API_KEY'));

      if (!pass) {
        const missingKeyName = isResendProvider ? 'RESEND_API_KEY' : 'SENDGRID_API_KEY';
        this.logger.warn(`Email skipped because ${missingKeyName} / SMTP credentials are not configured.`);
        return false;
      }

      try {
        const transporter = nodemailer.createTransport({
          host,
          port: smtpPort || 587,
          secure: smtpPort === 465,
          auth: { user, pass },
        });

        await transporter.sendMail({
          from: `${fromName} <${fromAddress}>`,
          to,
          subject,
          text,
          html,
        });

        return true;
      } catch (error) {
        this.logger.error(`Failed to send email via ${isResendProvider ? 'Resend' : 'SMTP/SendGrid'}`, error instanceof Error ? error.stack : error);
        return false;
      }
    }

    if (!smtpHost || !smtpUser || !smtpPass) {
      const noConfigReason = isResendProvider || hasExplicitResendKey ? 'Resend' : 'SMTP';
      this.logger.warn(`Email skipped because ${noConfigReason} credentials are not configured.`);
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 587,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `${fromName} <${fromAddress}>`,
        to,
        subject,
        text,
        html,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to send email', error instanceof Error ? error.stack : error);
      return false;
    }
  }
}