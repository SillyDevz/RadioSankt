import { useState, type ReactNode } from 'react';
import {
  useFloating,
  useHover,
  useInteractions,
  useDismiss,
  useRole,
  offset,
  FloatingPortal,
  type Placement,
} from '@floating-ui/react';

interface TooltipProps {
  content: string;
  placement?: Placement;
  shortcut?: string;
  children: ReactNode;
}

function Tooltip({ content, placement = 'top', shortcut, children }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(8)],
  });

  const hover = useHover(context, { delay: { open: 400, close: 0 } });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </span>
      <FloatingPortal>
        {isOpen && (
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              opacity: isOpen ? 1 : 0,
              transition: 'opacity 150ms ease',
            }}
            className="bg-bg-elevated text-text-secondary text-xs px-2 py-1 rounded shadow-lg pointer-events-none"
            {...getFloatingProps()}
          >
            {content}
            {shortcut && (
              <kbd className="ml-1.5 px-1 py-0.5 bg-bg-primary rounded text-[10px] text-text-muted font-mono">
                {shortcut}
              </kbd>
            )}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}

export default Tooltip;
