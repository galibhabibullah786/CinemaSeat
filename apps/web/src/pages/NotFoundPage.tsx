import { ArrowLeft, Clapperboard } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return <div className="not-found shell page-section"><span className="not-found__code">404</span><span className="not-found__icon"><Clapperboard size={28} /></span><h1>This scene didn’t make the final cut.</h1><p>The page may have moved, but tonight’s movies are still waiting.</p><Link className="button button--primary" to="/"><ArrowLeft size={16} /> Back to discover</Link></div>;
}
