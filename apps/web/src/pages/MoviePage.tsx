import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, MapPin, Play, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cinemaApi } from "../api/cinema-api";
import { queryKeys } from "../api/query-keys";
import { formatDateTime, formatDuration, formatMoney, formatTime, toDateKey } from "../lib/format";
import { Badge, Button, Card, EmptyState, ErrorState, MoviePoster, Skeleton } from "../components/ui";

function dateForOffset(offset: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

export default function MoviePage() {
  const { movieId = "" } = useParams();
  const [dateOffset, setDateOffset] = useState(0);
  const movieQuery = useQuery({ queryKey: queryKeys.movie(movieId), queryFn: ({ signal }) => cinemaApi.getMovie(movieId, signal), enabled: Boolean(movieId) });
  const showtimesQuery = useQuery({ queryKey: queryKeys.showtimes(movieId), queryFn: ({ signal }) => cinemaApi.getShowtimes(movieId, signal), enabled: Boolean(movieId) });
  const selectedDate = dateForOffset(dateOffset);
  const selectedKey = toDateKey(selectedDate);
  const showtimes = useMemo(() => (showtimesQuery.data ?? []).filter((showtime) => toDateKey(new Date(showtime.startsAt)) === selectedKey), [selectedKey, showtimesQuery.data]);
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof showtimes>();
    for (const showtime of showtimes) groups.set(showtime.theatreName, [...(groups.get(showtime.theatreName) ?? []), showtime]);
    return [...groups.entries()];
  }, [showtimes]);
  const movie = movieQuery.data;

  if (movieQuery.isPending) return <div className="shell page-section"><Skeleton className="movie-detail-hero-skeleton" /></div>;
  if (movieQuery.isError || !movie) return <div className="shell page-section"><ErrorState title="Movie not found" message="That title may have left the marquee. Head back to discover what's playing." onRetry={() => void movieQuery.refetch()} /><Link className="button button--secondary" to="/"><ArrowLeft size={16} /> Back to discover</Link></div>;

  return <>
    <section className="movie-detail-hero"><div className="movie-detail-backdrop" style={movie.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(6,8,12,.98), rgba(6,8,12,.62), rgba(6,8,12,.22)), url(${movie.backdropUrl})` } : undefined} /><div className="shell movie-detail-content"><Link className="back-link" to="/"><ArrowLeft size={15} /> Back to discover</Link><div className="movie-detail-grid"><MoviePoster src={movie.posterUrl} title={movie.title} className="movie-detail-poster" /><div className="movie-detail-copy"><Badge tone="accent">Now showing</Badge><h1>{movie.title}</h1><div className="hero-meta">{movie.certificate ? <span>{movie.certificate}</span> : null}{movie.durationMinutes ? <span><Clock3 size={14} /> {formatDuration(movie.durationMinutes)}</span> : null}{movie.genres?.map((genre) => <span key={genre}>{genre}</span>)}</div><p>{movie.synopsis ?? "A new story is waiting in the dark."}</p><div className="movie-detail-facts"><span><MapPin size={15} /> Three cinemas nearby</span><span><Users size={15} /> Seats update live</span></div><button type="button" className="trailer-link"><Play size={15} fill="currentColor" /> Watch the trailer <span>Coming soon</span></button></div></div></div></section>
    <section className="shell page-section showtimes-section" aria-labelledby="showtimes-heading"><div className="section-heading"><div><span className="eyebrow">Choose your moment</span><h2 id="showtimes-heading">Showtimes</h2></div><span className="section-note"><CalendarDays size={15} /> {formatDateTime(selectedDate.toISOString(), { weekday: "long", year: undefined, month: "long", day: "numeric", hour: undefined, minute: undefined })}</span></div><div className="date-selector" role="tablist" aria-label="Showtime date">{[0, 1, 2, 3].map((offset) => { const date = dateForOffset(offset); return <button type="button" role="tab" aria-selected={offset === dateOffset} className={`date-card ${offset === dateOffset ? "date-card--active" : ""}`} key={offset} onClick={() => setDateOffset(offset)}><span>{offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span><strong>{date.getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)}</small></button>; })}</div>
      {showtimesQuery.isPending ? <div className="showtime-groups"><Skeleton className="showtime-skeleton" /><Skeleton className="showtime-skeleton" /></div> : showtimesQuery.isError ? <ErrorState message="Showtimes are taking a little longer than expected." onRetry={() => void showtimesQuery.refetch()} /> : grouped.length === 0 ? <EmptyState icon={<CalendarDays size={20} />} title="No showtimes that day" message="Try another date; the next screening could be closer than you think." action={<Button variant="secondary" size="sm" onClick={() => setDateOffset(0)}>See today's times</Button>} /> : <div className="showtime-groups">{grouped.map(([theatre, theatreShowtimes]) => <Card className="theatre-group" key={theatre}><div className="theatre-heading"><div><MapPin size={17} /><div><h3>{theatre}</h3><p>Comfortable rooms · Easy entry</p></div></div><span>{theatreShowtimes.reduce((sum, item) => sum + (item.availableSeats ?? 0), 0)} seats across rooms</span></div><div className="showtime-pills">{theatreShowtimes.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((showtime) => <Link to={`/showtimes/${showtime.id}/seats`} className="showtime-pill" key={showtime.id}><strong>{formatTime(showtime.startsAt)}</strong><span>{showtime.screenName ?? "Standard screen"}</span><small>{formatMoney(showtime.priceCents, showtime.currency)} · {showtime.availableSeats ?? "Live"} left</small><ArrowRight size={15} aria-hidden="true" /></Link>)}</div></Card>)}</div>}
    </section>
  </>;
}
