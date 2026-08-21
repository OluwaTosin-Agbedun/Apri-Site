import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * The router does not restore scroll position for hash targets, so navigating to
 * /#publications from another page would otherwise leave the reader at the top.
 * Scrolls to the hash target on change, and to the top when there is none.
 */
export default function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }

    const target = document.getElementById(hash.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [pathname, hash]);

  return null;
}
