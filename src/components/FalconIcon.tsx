'use client';

import React from 'react';

export function FalconIcon({ className = "w-6 h-6", color = "currentColor" }: { className?: string, color?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke={color} 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      {/* Geometric Stylized Falcon */}
      <path d="M22 3L12 10L2 3" />
      <path d="M12 10V21" />
      <path d="M12 10L18 15" />
      <path d="M12 10L6 15" />
      <path d="M22 3C19 6 16 10 12 10C8 10 5 6 2 3" />
    </svg>
  );
}
