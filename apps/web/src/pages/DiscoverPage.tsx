import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronRight, Clock3, HeartHandshake, Search, ShieldCheck, Sparkles, Ticket, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cinemaApi } from "../api/cinema-api";
import { queryKeys } from "../api/query-keys";
import type { Movie } from "../api/types";
import { formatDuration, formatTime, toDateKey } from "../lib/format";
import { cn } from "../lib/cn";
import { Badge, Button, EmptyState, ErrorState, MoviePoster, Skeleton } from "../components/ui";

export function MovieCard({ movie, featured = false, nextShowtime }: { movie: Movie; featured?: boolean; nextShowtime?: string }) {
  return <Link to={`/movies/${movie.id}`} className={cn("movie-card", featured && "movie-card--featured")}>
    <MoviePoster src={movie.posterUrl} title={movie.title} />
    <div className="movie-card__body"><div className="movie-card__title-row"><h3>{movie.title}</h3>{movie.certificate ? <Badge>{movie.certificate}</Badge> : null}</div><p>{[movie.genres?.slice(0, 2).join(" · "), formatDuration(movie.durationMinutes)].filter(Boolean).join("  ·  ")}</p>{nextShowtime ? <span className="movie-card__next"><Clock3 size={13} /> Next at {formatTime(nextShowtime)}</span> : null}<span className="movie-card__cta">View showtimes <ArrowRight size={14} /></span></div>
  </Link>;
}

const dateFilters = ["Today", "Tomorrow", "Weekend"] as const;

export default function DiscoverPage() {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<(typeof dateFilters)[number]>("Today");
  const moviesQuery = useQuery({ queryKey: queryKeys.movies, queryFn: ({ signal }) => cinemaApi.getMovies(signal) });
  const showtimesQuery = useQuery({ queryKey: queryKeys.showtimes(), queryFn: ({ signal }) => cinemaApi.getShowtimes(undefined, signal) });
  const movies = useMemo(() => moviesQuery.data ?? [], [moviesQuery.data]);
  const matchingShowtimes = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return (showtimesQuery.data ?? []).filter((showtime) => {
      const date = new Date(showtime.startsAt);
      if (dateFilter === "Today") return toDateKey(date) === toDateKey(today);
      if (dateFilter === "Tomorrow") return toDateKey(date) === toDateKey(tomorrow);
      return date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) && date.getDay() % 6 === 0;
    });
  }, [dateFilter, showtimesQuery.data]);
  const filteredMovies = useMemo(() => {
    const supportedMovies = new Set(matchingShowtimes.map((showtime) => showtime.movieId));
    return movies.filter((movie) => movie.title.toLowerCase().includes(search.toLowerCase().trim()) && (showtimesQuery.isError || showtimesQuery.isPending || supportedMovies.has(movie.id)));
  }, [matchingShowtimes, movies, search, showtimesQuery.isError, showtimesQuery.isPending]);
  const featured = movies[0];

  return <>
    <section className="hero-section">
      <div className="hero-backdrop" style={featured?.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(6,8,12,.98) 4%, rgba(6,8,12,.82) 44%, rgba(6,8,12,.28)), linear-gradient(180deg, rgba(6,8,12,.12), #06080c 98%), url(${featured.backdropUrl})` } : undefined} />
      <div className="shell hero-content">
        <div className="hero-copy">
          <Badge tone="accent"><Sparkles size={13} /> Premiere pick · Tonight</Badge>
          <h1>{featured?.title ?? "Your next great night out"}</h1>
          <p className="hero-lede">{featured?.synopsis ?? "Discover a better way to find the right film, the right seat, and the right moment."}</p>
          <div className="hero-meta">{featured?.certificate ? <span>{featured.certificate}</span> : null}{featured?.durationMinutes ? <span><Clock3 size={14} /> {formatDuration(featured.durationMinutes)}</span> : null}{featured?.genres?.map((genre) => <span key={genre}>{genre}</span>)}</div>
          <div className="hero-actions">{featured ? <Link to={`/movies/${featured.id}`} className="button button--primary button--lg">Book premiere <ArrowRight size={17} /></Link> : <Button size="lg" disabled>Loading premiere</Button>}{featured ? <Link to={`/movies/${featured.id}`} className="button button--secondary button--lg">View details</Link> : null}</div>
          <div className="trust-strip"><span><Zap size={15} /> Live availability</span><span><ShieldCheck size={15} /> Secure seat hold</span><span><HeartHandshake size={15} /> Calm confirmation</span></div>
        </div>
        {featured ? <div className="hero-poster-wrap"><MoviePoster src={featured.posterUrl} title={featured.title} className="hero-poster" /><span className="hero-poster-glow" aria-hidden="true" /></div> : <Skeleton className="hero-poster-skeleton" />}
      </div>
    </section>

    <section className="shell discover-section" aria-labelledby="now-showing-heading">
      <div className="section-heading"><div><span className="eyebrow">The marquee</span><h2 id="now-showing-heading">Now showing</h2></div><Link className="text-link" to="/lookup">Find a booking <ArrowRight size={14} /></Link></div>
      <div className="filter-row">
        <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Search movies</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title" /></label>
        <div className="date-chips" aria-label="Filter showtimes by date">{dateFilters.map((filter) => <button type="button" key={filter} className={cn("chip", dateFilter === filter && "chip--active")} aria-pressed={dateFilter === filter} onClick={() => setDateFilter(filter)}><CalendarDays size={14} />{filter}</button>)}</div>
      </div>
      <p className="filter-hint">Showing films with seats available <span>·</span> {dateFilter} <span>·</span> Updates as seats move</p>
      {moviesQuery.isPending ? <div className="movie-grid">{Array.from({ length: 4 }, (_, index) => <div className="movie-card movie-card--skeleton" key={index}><Skeleton className="poster-frame" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line skeleton-line--short" /></div>)}</div> : moviesQuery.isError ? <ErrorState message="We couldn't load the marquee right now." requestId={moviesQuery.error instanceof Error && "requestId" in moviesQuery.error ? String((moviesQuery.error as { requestId?: unknown }).requestId) : undefined} onRetry={() => void moviesQuery.refetch()} /> : filteredMovies.length === 0 ? <EmptyState icon={<Search size={20} />} title="No films match those filters" message="Try another date or clear the search to see more screenings." action={<Button size="sm" variant="secondary" onClick={() => { setSearch(""); setDateFilter("Today"); }}>Reset filters</Button>} /> : <div className="movie-grid">{filteredMovies.map((movie) => <MovieCard movie={movie} key={movie.id} nextShowtime={matchingShowtimes.filter((showtime) => showtime.movieId === movie.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt} />)}</div>}
    </section>

    <section className="shell proof-strip" aria-labelledby="proof-heading"><div className="proof-intro"><span className="eyebrow">Built for the rush</span><h2 id="proof-heading">Every important moment, made clear.</h2></div><div className="proof-items"><div><span className="proof-icon"><Zap size={18} /></span><div><h3>Live inventory</h3><p>See the room as it changes, with a gentle refresh.</p></div></div><div><span className="proof-icon"><Ticket size={18} /></span><div><h3>Temporary holds</h3><p>A visible timer gives you room to verify and pay.</p></div></div><div><span className="proof-icon"><ShieldCheck size={18} /></span><div><h3>Reliable payments</h3><p>Async confirmation keeps uncertainty out of your ticket.</p></div></div></div></section>

    <section className="shell closing-cta"><div><span className="eyebrow">A seat with your name on it</span><h2>Make tonight the main event.</h2></div><Link to={featured ? `/movies/${featured.id}` : "/"} className="button button--primary">Browse the marquee <ChevronRight size={17} /></Link></section>
  </>;
}
