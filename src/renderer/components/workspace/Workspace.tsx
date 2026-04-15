import AutomationQueueWidget from './AutomationQueueWidget';
import CartWallWidget from './CartWallWidget';
import SearchWidget from './SearchWidget';
import JingleManagerModal from './JingleManagerModal';

export default function Workspace() {
  return (
    <>
      <div className="h-full w-full p-4 overflow-hidden flex gap-4 bg-bg-primary">
        {/* Left Column: Automation Queue */}
        <div className="w-[40%] min-w-[420px] flex flex-col h-full">
          <AutomationQueueWidget />
        </div>

        {/* Right Column: Carts & Search */}
        <div className="flex-1 flex flex-col gap-4 min-w-[520px] h-full">
          <div className="h-1/2 min-h-[300px]">
            <CartWallWidget />
          </div>
          <div className="flex-1 min-h-0">
            <SearchWidget />
          </div>
        </div>
      </div>

      {/* Globals */}
      <JingleManagerModal />
    </>
  );
}

