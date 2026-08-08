-- DropTable
DROP TABLE IF EXISTS "items";

-- CreateTable
CREATE TABLE "movies" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "synopsis" TEXT,
    "poster_url" VARCHAR(500),
    "backdrop_url" VARCHAR(500),
    "duration_minutes" INTEGER NOT NULL,
    "certificate" VARCHAR(20),
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theatres" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "location" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theatres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screens" (
    "id" TEXT NOT NULL,
    "theatre_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "row_label" VARCHAR(10) NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "seat_class" VARCHAR(50) NOT NULL DEFAULT 'Standard',
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showtimes" (
    "id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "theatre_id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showtimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_inventories" (
    "id" TEXT NOT NULL,
    "showtime_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
    "price_cents" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "held_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "ref" VARCHAR(50) NOT NULL,
    "showtime_id" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'HELD',
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "phone" VARCHAR(50),
    "qr_payload" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_seats" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,

    CONSTRAINT "booking_seats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seats_screen_id_row_label_seat_number_key" ON "seats"("screen_id", "row_label", "seat_number");

-- CreateIndex
CREATE INDEX "showtimes_movie_id_idx" ON "showtimes"("movie_id");

-- CreateIndex
CREATE INDEX "showtimes_starts_at_idx" ON "showtimes"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "seat_inventories_showtime_id_seat_id_key" ON "seat_inventories"("showtime_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_ref_key" ON "bookings"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "booking_seats_booking_id_seat_id_key" ON "booking_seats"("booking_id", "seat_id");

-- AddForeignKey
ALTER TABLE "screens" ADD CONSTRAINT "screens_theatre_id_fkey" FOREIGN KEY ("theatre_id") REFERENCES "theatres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_theatre_id_fkey" FOREIGN KEY ("theatre_id") REFERENCES "theatres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_inventories" ADD CONSTRAINT "seat_inventories_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "showtimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_inventories" ADD CONSTRAINT "seat_inventories_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "showtimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_seats" ADD CONSTRAINT "booking_seats_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_seats" ADD CONSTRAINT "booking_seats_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
