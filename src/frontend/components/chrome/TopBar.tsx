import { memo, useEffect, useState } from 'react';
import { TopTabs } from './TopTabs';
import type { Screen } from '../../App';
import appLogo from '../../assets/icons/icon.png';

/** Memoized: only re-renders when the open tabs or active tab change — not on the
 *  app's frequent data refreshes (recordings, activity, etc.). */
export const TopBar = memo(function TopBar({ tabs, onSelectTab, onCloseTab }: {
  tabs: Screen[];
  onSelectTab: (s: Screen) => void;
  onCloseTab: (s: Screen) => void;
}) {
  const [version, setVersion] = useState('');
  useEffect(() => { window.curryLeaves?.getAppVersion().then(setVersion).catch(() => {}); }, []);

  return (
    <header className="app-topbar relative h-[40px] flex-none drag flex items-end bg-sidebar pr-3">
      {/* left spacer clears the macOS traffic lights (stays draggable) */}
      <div className="w-[78px] flex-none" />
      {/* only the tabs are no-drag; the rest of the bar stays draggable */}
      <div className="no-drag flex-none flex items-end max-w-[70%] overflow-x-auto">
        <TopTabs tabs={tabs} onSelect={onSelectTab} onClose={onCloseTab} />
      </div>
      {/* draggable spacer fills the gap so you can still drag the window */}
      <div className="flex-1 self-stretch" />
      <div className="flex items-center gap-1.5 self-center flex-none select-none">
        <img src={appLogo} alt="" draggable={false} className="w-4 h-4 object-contain flex-none" />
        <span className="font-serif font-semibold tracking-tight text-[13px] text-sidebar-ink">Curry Leaves</span>
        {version && <span className="font-mono text-[11px] text-sidebar-faint">v{version}</span>}
      </div>
    </header>
  );
});
