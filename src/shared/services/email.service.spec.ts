import { ConfigService } from '@nestjs/config';
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
});
