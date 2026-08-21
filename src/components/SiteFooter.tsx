import React from 'react';

export default function SiteFooter() {
  return (
    <footer className="pt-8 border-t border-border/40 text-xs text-muted-foreground flex justify-between items-center">
      <p>&copy; {new Date().getFullYear()} Athena Centre. All rights reserved.</p>
      <div className="w-2 h-2 bg-accent/40 rounded-full"></div>
    </footer>
  );
}
