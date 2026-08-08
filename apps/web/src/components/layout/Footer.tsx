import { Activity, ArrowUpRight, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cinemaApi, useMockMode } from "../../api/cinema-api";

export function Footer() {
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => cinemaApi.getHealth(signal), staleTime: 30_000, retry: 0 });
  return <footer className="site-footer"><div className="shell footer-grid">
    <div><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">✦</span><span>Cinema<span>Seat</span></span></Link><p className="footer-note">A calmer way to catch the big screen.</p></div>
    <div><h2>Explore</h2><Link to="/">Now showing</Link><Link to="/lookup">Find a booking</Link></div>
    <div><h2>System</h2><span className="footer-status"><Activity size={14} /> {useMockMode ? "Demo mode" : health.isError ? "Needs attention" : "Operational"}</span><span className="footer-note">References stay on this device.</span></div>
  </div><div className="shell footer-bottom"><span>Built for the rush · Hackathon project</span><span>Made with <Heart size={13} fill="currentColor" /> for movie nights <ArrowUpRight size={13} aria-hidden="true" /></span></div></footer>;
}
