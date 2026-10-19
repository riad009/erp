import { redirect } from 'next/navigation';

// Step 1: the whole app is still the single file public/khata/index.html.
// Later steps move each tab into React components (see CLAUDE.md → Roadmap).
export default function Home() {
  redirect('/khata/index.html');
}
