import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

describe('EmailService', () => {
  it('builds a receipt email body with summary details', () => {
    const service = new EmailService({
      get: (key: string) => {
        if (key === 'APP_NAME') return 'Zentra';
        return undefined;
      },
    } as unknown as ConfigService);

    const html = service.buildReceiptHtml({
      customerName: 'Jane Doe',
      bookingId: 'abc-123',
      amount: 2500,
      currency: 'NGN',
      reference: 'TX-001',
      status: 'PAID',
      createdAt: new Date('2026-01-15T10:00:00Z'),
    });

    expect(html).toContain('Jane Doe');
    expect(html).toContain('abc-123');
    expect(html).toContain('₦2,500.00');
    expect(html).toContain('TX-001');
    expect(html).toContain('PAID');
  });

  it('generates a QR code data URL for ticket payloads', async () => {
    const service = new EmailService({
      get: () => undefined,
    } as unknown as ConfigService);

    const qr = await service.generateTicketQrDataUrl({
      bookingId: 'booking-42',
      eventId: 'event-7',
      userId: 'user-99',
      guestCount: 2,
    });

    expect(qr).toContain('data:image/png;base64,');
  });

  it('uses Resend SMTP configuration when EMAIL_PROVIDER=resend', async () => {
    const service = new EmailService({
      get: (key: string) => {
        switch (key) {
          case 'EMAIL_PROVIDER':
            return 'resend';
          case 'EMAIL_FROM':
            return 'noreply@zentra.app';
          case 'EMAIL_FROM_NAME':
            return 'Zentra';
          case 'RESEND_API_KEY':
            return 're_test_key';
          default:
            return undefined;
        }
      },
    } as unknown as ConfigService);

    const sendMail = jest.fn().mockResolvedValue({ messageId: 'abc' });
    const createTransportSpy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail,
    } as any);

    const sent = await (service as any).sendEmail({
      to: 'user@example.com',
      subject: 'Reset your password',
      html: '<p>code</p>',
      text: 'code',
    });

    expect(sent).toBe(true);
    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.resend.com',
        auth: { user: 'resend', pass: 're_test_key' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Reset your password',
      }),
    );

    createTransportSpy.mockRestore();
  });
});
