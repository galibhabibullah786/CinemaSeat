import { useState } from "react";
import { Activity, Clapperboard, Menu, X } from "lucide-react";
import { NavLink, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cinemaApi, useMockMode } from "../../api/cinema-api";
import { cn } from "../../lib/cn";

export function Header() {
  const [open, setOpen] = useState(false);
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => cinemaApi.getHealth(signal), staleTime: 30_000, retry: 0 });
  const statusLabel = health.isPending ? "Checking systems" : health.isError ? "Check status" : health.data?.label ?? "Systems operational";
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" to="/" onClick={() => setOpen(false)} aria-label="CinemaSeat home">
          <span className="brand-mark" aria-hidden="true"><Clapperboard size={17} /></span>
          <span>Cinema<span>Seat</span></span>
        </Link>
        <nav className={cn("desktop-nav", open && "mobile-nav--open")} aria-label="Primary navigation">
          <NavLink to="/" end onClick={() => setOpen(false)}>Discover</NavLink>
          <NavLink to="/lookup" onClick={() => setOpen(false)}>My booking</NavLink>
          <span className={cn("health-status", health.isError && "health-status--error")} title={statusLabel}>
            <Activity size={14} aria-hidden="true" /><span className="health-dot" aria-hidden="true" />{useMockMode ? "Demo systems" : statusLabel}
          </span>
        </nav>
        <button className="icon-button menu-toggle" type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
  );
}
