import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { Event } from '../../shared/entities/event.entity';
import { ApartmentListing } from '../../shared/entities/apartment-listing.entity';
import { CarListing } from '../../shared/entities/car-listing.entity';
import { Venue } from '../../shared/entities/venue.entity';
import { Queue } from '../../shared/entities/queue.entity';
import { JetListing } from '../../shared/entities/jet-listing.entity';
import { ItineraryService } from './itinerary.service';
import { ItineraryController } from './itinerary.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Event, ApartmentListing, CarListing, Venue, Queue, JetListing]),
  ],
  providers: [ItineraryService],
  controllers: [ItineraryController],
  exports: [ItineraryService],
})
export class ItineraryModule {}
