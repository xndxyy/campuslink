import Image from 'next/image';
import Link from 'next/link';

export function SiteBrand() {
  return (
    <Link aria-label="西大同学 CampusLink 首页" className="site-brand" href="/">
      <Image
        alt=""
        className="site-brand-mark"
        height={40}
        priority
        src="/brand/campuslink-mark-light.png"
        width={40}
      />
      <span className="site-brand-label-full">西大同学 CampusLink</span>
      <span aria-hidden="true" className="site-brand-label-compact">
        CampusLink
      </span>
    </Link>
  );
}
