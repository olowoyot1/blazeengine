import './style.css';
export const metadata = { title: 'Landblaze Engine', description: 'Real-estate sales & site-allocation workflow' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
