import Link from "next/link";
export function SiteNav() {
  return <nav className="topbar" aria-label="Primary navigation"><Link className="brand" href="/">✚ DeployDoctor</Link>
    <div className="nav-links"><Link href="/pricing">Pricing</Link><Link href="/account">My scans</Link></div></nav>;
}
