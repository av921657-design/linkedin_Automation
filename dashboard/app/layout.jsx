import './globals.css';

export const metadata = {
  title: 'Cadence — LinkedIn Automation Dashboard',
  description: 'Schedule, sources, formatting and recovery for the posting machine on your Mac.',
};

// Runs before first paint so the correct palette is applied with no flash.
// Falls back to the OS preference; the toggle stores the choice in localStorage.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('cadence-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
