
import React from 'react';

interface StealthUIProps {
  isVisible: boolean;
  children: React.ReactNode;
  onToggle: () => void;
}

export const StealthUI: React.FC<StealthUIProps> = ({ isVisible, children, onToggle }) => {
  return (
    <div 
      className={`fixed inset-0 z-40 transition-all duration-700 pointer-events-none ${
        isVisible 
          ? 'bg-black/0' 
          : 'bg-black'
      }`}
    >
      <div className={`
        h-full w-full pointer-events-auto
        transition-all duration-700 ease-in-out
        ${isVisible ? 'opacity-0 scale-[0.98] translate-y-4' : 'opacity-100 scale-100 translate-y-0'}
      `}>
        {children}
      </div>
    </div>
  );
};
