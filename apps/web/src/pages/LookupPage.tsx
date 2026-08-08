import { useState } from "react";
import { ArrowRight, Clock3, History, Search, ShieldCheck, Ticket } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, EmptyState } from "../components/ui";
import { getRecentBookingRefs } from "../lib/storage";

export default function LookupPage() {
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [recent] = useState(() => getRecentBookingRefs());
  const normalized = reference.trim().toUpperCase();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (normalized) navigate(`/booking/${encodeURIComponent(normalized)}`);
  };
  return <div className="lookup-page shell page-section"><div className="lookup-hero"><span className="lookup-icon"><Ticket size={24} /></span><span className="eyebrow">No account needed</span><h1>Find your booking.</h1><p>Enter the reference from your confirmation to see the latest status and ticket.</p></div><div className="lookup-grid"><Card className="lookup-card"><h2>Booking reference</h2><p>It looks like <code>CS-2026-02401</code>.</p><form onSubmit={submit}><label className="field-label" htmlFor="booking-reference">Your reference</label><div className="input-with-icon input-with-icon--large"><Search size={18} aria-hidden="true" /><input id="booking-reference" autoCapitalize="characters" autoComplete="off" value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} placeholder="CS-2026-02401" /></div><Button type="submit" size="lg" disabled={!normalized}>View booking <ArrowRight size={16} /></Button></form><div className="privacy-note"><ShieldCheck size={16} /><span><strong>Private by design</strong>We only save recent booking references on this device—never personal or payment data.</span></div></Card><section className="recent-panel" aria-labelledby="recent-heading"><div className="section-heading"><div><span className="eyebrow">This device</span><h2 id="recent-heading">Recent bookings</h2></div><History size={19} /></div>{recent.length ? <div className="recent-list">{recent.map((ref) => <Link to={`/booking/${encodeURIComponent(ref)}`} key={ref}><span className="recent-icon"><Clock3 size={16} /></span><div><strong>{ref}</strong><small>Open latest status</small></div><ArrowRight size={16} /></Link>)}</div> : <EmptyState icon={<History size={20} />} title="No recent references" message="Bookings you make on this device will appear here for a quick return." action={<Link className="button button--secondary button--sm" to="/">Discover movies</Link>} />}</section></div></div>;
}
