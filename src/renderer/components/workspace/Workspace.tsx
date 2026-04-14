import AutomationQueueWidget from './AutomationQueueWidget';
import CartWallWidget from './CartWallWidget';
import SearchWidget from './SearchWidget';
import StepInspectorWidget from './StepInspectorWidget';
import JingleManagerModal from './JingleManagerModal';

export default function Workspace() {
  return (
    <>
      <div className="h-full w-full p-4 overflow-hidden flex gap-4 bg-bg-primary">
        {/* Left Column: Automation Queue */}
        <div className="w-[32%] min-w-[340px] flex flex-col h-full">
          <AutomationQueueWidget />
        </div>

        {/* Middle Column: Carts & Search */}
        <div className="flex-1 flex flex-col gap-4 min-w-[400px] h-full">
          <div className="h-[45%] min-h-[250px]">
            <CartWallWidget />
          </div>
          <div className="flex-1 min-h-0">
            <SearchWidget />
          </div>
        </div>

        {/* Right Column: Inspector */}
        <div className="w-[28%] min-w-[300px] flex flex-col gap-4 h-full">
          <div className="flex-1 min-h-0">
            <StepInspectorWidget />
          </div>
        </div>
      </div>

      {/* Globals */}
      <JingleManagerModal />
    </>
  );
}

