import React from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function ModalShell({ open, onClose, children, className = '' }: ModalShellProps) {
  useEscapeKey(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-bg-surface border border-border rounded-2xl shadow-2xl ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
