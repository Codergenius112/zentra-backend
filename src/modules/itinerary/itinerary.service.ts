import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { Event } from '../../shared/entities/event.entity';
import { ApartmentListing } from '../../shared/entities/apartment-listing.entity';
import { CarListing } from '../../shared/entities/car-listing.entity';
import { Venue } from '../../shared/entities/venue.entity';
import { Queue } from '../../shared/entities/queue.entity';
import { JetListing } from '../../shared/entities/jet-listing.entity';
import { BookingStatus } from '../../shared/enums';

export type ItineraryItemType = 'ride' | 'jet' | 'stay' | 'event' | 'table' | 'queue';

export interface ItineraryItem {
  id: string;
  bookingId: string;
  type: ItineraryItemType;
  title: string;
  subtitle: string | null;
  timestamp: string | null; // null only for a live queue entry with no fixed time
  status: string;
  queuePosition?: number;
}

// Bookings still worth showing on a forward-looking trip plan — anything
// dead (cancelled/expired) or already wrapped up (completed) is excluded.
const ACTIVE_STATUSES = [
  BookingStatus.INITIATED,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.PENDING_GROUP_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.ACTIVE,
];

const ACTIVE_QUEUE_STATUSES = ['WAITING', 'CALLED'];

@Injectable()
export class ItineraryService {
  constructor(
    @InjectRepository(Booking) private bookingRepository: Repository<Booking>,
    @InjectRepository(Event) private eventRepository: Repository<Event>,
    @InjectRepository(ApartmentListing) private apartmentRepository: Repository<ApartmentListing>,
    @InjectRepository(CarListing) private carRepository: Repository<CarListing>,
    @InjectRepository(Venue) private venueRepository: Repository<Venue>,
    @InjectRepository(Queue) private queueRepository: Repository<Queue>,
    @InjectRepository(JetListing) private jetRepository: Repository<JetListing>,
  ) {}

  async getUserItinerary(userId: string): Promise<ItineraryItem[]> {
    const [bookings, queueEntries] = await Promise.all([
      this.bookingRepository.find({
        where: { userId, status: In(ACTIVE_STATUSES) },
      }),
      this.queueRepository.find({
        where: { userId, status: In(ACTIVE_QUEUE_STATUSES) },
      }),
    ]);

    // Batch-fetch every referenced resource in one query per type.
    const eventIds = new Set<string>();
    const apartmentIds = new Set<string>();
    const carIds = new Set<string>();
    const jetIds = new Set<string>();
    const venueIds = new Set<string>();

    for (const b of bookings) {
      if (b.bookingType === 'ticket') eventIds.add(b.resourceId);
      if (b.bookingType === 'apartment') apartmentIds.add(b.resourceId);
      if (b.bookingType === 'car') carIds.add(b.resourceId);
      if (b.bookingType === 'jet') jetIds.add(b.resourceId);
      if (b.bookingType === 'table') {
        if (b.metadata?.venueId) venueIds.add(b.metadata.venueId);
        if (b.metadata?.eventId) eventIds.add(b.metadata.eventId);
      }
    }
    for (const q of queueEntries) venueIds.add(q.venueId);

    const [events, apartments, cars, jets, venues] = await Promise.all([
      eventIds.size ? this.eventRepository.find({ where: { id: In([...eventIds]) } }) : [],
      apartmentIds.size ? this.apartmentRepository.find({ where: { id: In([...apartmentIds]) } }) : [],
      carIds.size ? this.carRepository.find({ where: { id: In([...carIds]) } }) : [],
      jetIds.size ? this.jetRepository.find({ where: { id: In([...jetIds]) } }) : [],
      venueIds.size ? this.venueRepository.find({ where: { id: In([...venueIds]) } }) : [],
    ]);

    const eventMap = new Map(events.map((e) => [e.id, e]));
    const apartmentMap = new Map(apartments.map((a) => [a.id, a]));
    const carMap = new Map(cars.map((c) => [c.id, c]));
    const jetMap = new Map(jets.map((j) => [j.id, j]));
    const venueMap = new Map(venues.map((v) => [v.id, v]));

    const items: ItineraryItem[] = [];

    for (const b of bookings) {
      if (b.bookingType === 'ticket') {
        const event = eventMap.get(b.resourceId);
        const venue = event?.venueId ? venueMap.get(event.venueId) : null;
        items.push({
          id: b.id,
          bookingId: b.id,
          type: 'event',
          title: event?.name ?? 'Event',
          subtitle: venue ? `at ${venue.name}` : 'Event',
          timestamp: event?.startDate ? new Date(event.startDate).toISOString() : null,
          status: b.status,
        });
      } else if (b.bookingType === 'table') {
        const venue = b.metadata?.venueId ? venueMap.get(b.metadata.venueId) : null;
        const event = b.metadata?.eventId ? eventMap.get(b.metadata.eventId) : null;
        items.push({
          id: b.id,
          bookingId: b.id,
          type: 'table',
          title: b.metadata?.tableName ?? 'Table Reservation',
          subtitle: venue ? `at ${venue.name}` : event ? `at ${event.name}` : null,
          timestamp: b.metadata?.bookingDate ?? null,
          status: b.status,
        });
      } else if (b.bookingType === 'apartment') {
        const apt = apartmentMap.get(b.resourceId);
        items.push({
          id: b.id,
          bookingId: b.id,
          type: 'stay',
          title: apt ? `Check-in: ${apt.name}` : 'Apartment Check-in',
          subtitle: apt ? `${apt.address}, ${apt.city}` : null,
          timestamp: b.metadata?.checkInDate ?? null,
          status: b.status,
        });
      } else if (b.bookingType === 'car') {
        const car = carMap.get(b.resourceId);
        items.push({
          id: b.id,
          bookingId: b.id,
          type: 'ride',
          title: car ? `${car.make} ${car.model} Pickup` : 'Ride Pickup',
          subtitle: b.metadata?.pickupLocation
            ? `at ${b.metadata.pickupLocation}`
            : car
            ? (car.withDriver ? 'Chauffeur-driven' : 'Self-drive')
            : null,
          timestamp: b.metadata?.pickupDate ?? null,
          status: b.status,
        });
      } else if (b.bookingType === 'jet') {
        const jet = jetMap.get(b.resourceId);
        const aircraftName = b.metadata?.aircraftName ?? jet?.name ?? 'Jet Charter';
        const route = [b.metadata?.departureAirport, b.metadata?.arrivalAirport]
          .filter(Boolean)
          .join(' → ');
        items.push({
          id: b.id,
          bookingId: b.id,
          type: 'jet',
          title: `${aircraftName} Charter`,
          subtitle: route || null,
          timestamp: b.metadata?.departureDate ?? null,
          status: b.status,
        });
      }
    }

    for (const q of queueEntries) {
      const venue = venueMap.get(q.venueId);
      items.push({
        id: q.id,
        bookingId: q.id,
        type: 'queue',
        title: venue ? `In Queue: ${venue.name}` : 'In Queue',
        subtitle: `Position #${q.position}`,
        timestamp: null, // live/dynamic — no fixed scheduled time
        status: q.status,
        queuePosition: q.position,
      });
    }

    // Timed items sorted chronologically first; live queue entries (no fixed
    // time) surface at the very top since they're the most time-sensitive —
    // your turn could be called any moment.
    const timed = items.filter((i) => i.timestamp).sort(
      (a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime(),
    );
    const untimed = items.filter((i) => !i.timestamp);

    return [...untimed, ...timed];
  }
}
