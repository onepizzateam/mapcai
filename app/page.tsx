import { Suspense } from 'react';
import { Nav } from './components/shell/Nav';
import { Topbar } from './components/shell/Topbar';
import { FleetProvider } from './components/shell/FleetProvider';
import { FleetMap } from './components/map/FleetMap';
import { Sidebar } from './components/sidebar/Sidebar';
import { BottomSheet } from './components/sidebar/BottomSheet';


// RSC shell — static chrome, no data (agents.md §3).
//
// This component ships zero client JS of its own: it renders the layout grid on
// the server so the shell paints immediately (LCP target < 1.5s, §8), then hands
// off to the client islands. The map is inherently client-rendered — RSC buys the
// initial HTML paint, nothing more, and the plan is explicit about not
// overselling that.
//
// Suspense wraps FleetProvider because useUrlSync calls useSearchParams, which
// requires a suspense boundary during static rendering.

export default function Page() {
  return (
    <Suspense fallback={null}>
      <FleetProvider>
        <div className="flex h-dvh w-full overflow-hidden bg-bg">
          <Nav />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />

            {/* Map + sidebar. Below md the sidebar is a fixed-position bottom
                sheet (see .fleet-sheet in globals.css), so it leaves the flex
                flow and the map fills the viewport full-bleed underneath it —
                no height split, no wasted map. At md+ the sheet reverts to a
                static right-hand rail. */}
            <main className="relative flex min-h-0 flex-1 flex-col md:flex-row">
              <section
                className="relative min-h-0 flex-1 overflow-hidden"
                aria-label="Fleet map"
              >
                <FleetMap />
              </section>

              <BottomSheet>
                <Sidebar />
              </BottomSheet>
            </main>

          </div>
        </div>
      </FleetProvider>
    </Suspense>
  );
}
