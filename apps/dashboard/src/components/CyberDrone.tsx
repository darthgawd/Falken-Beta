'use client';

import React, { useMemo } from 'react';

interface CyberDroneProps {
  address: string;
  size?: number;
  className?: string;
  isAnimated?: boolean;
}

/**
 * CyberDrone: A deterministic 8-bit identity layer for Falken Agents.
 * Generates a unique, mirrored drone sprite based on a wallet address.
 */
export function CyberDrone({ address, size = 32, className = '', isAnimated = true }: CyberDroneProps) {
  // 1. Simple deterministic hash from address
  const hash = useMemo(() => {
    let h = 0;
    const addr = (address || '0x0000000000000000000000000000000000000000').toLowerCase();
    for (let i = 0; i < addr.length; i++) {
      h = ((h << 5) - h) + addr.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }, [address]);

  // 2. Generate the 8x8 (mirrored 4x8) grid
  const pixels = useMemo(() => {
    const grid: number[][] = [];
    let currentHash = hash;

    // We only generate 4 columns, then mirror for 8 columns total
    for (let y = 0; y < 8; y++) {
      const row: number[] = [];
      for (let x = 0; x < 4; x++) {
        // Deterministic bit for this pixel
        currentHash = (Math.imul(1664525, currentHash) + 1013904223) | 0;
        // Higher probability of empty space at edges/bottom for "drone" shape
        const threshold = (y < 2 || y > 6 || x === 0) ? 0.7 : 0.4;
        row.push(Math.abs(currentHash % 100) / 100 > threshold ? 1 : 0);
      }
      // Mirror the row
      grid.push([...row, ...[...row].reverse()]);
    }
    return grid;
  }, [hash]);

  // 3. Deterministic Colors
  const colors = useMemo(() => {
    const palettes = [
      { primary: '#2563EB', secondary: '#1E40AF', detail: '#60A5FA' }, // Blue (Strategist)
      { primary: '#EAB308', secondary: '#CA8A04', detail: '#FDE047' }, // Gold (High-Roller)
      { primary: '#DC2626', secondary: '#991B1B', detail: '#F87171' }, // Red (Aggressor)
      { primary: '#7C3AED', secondary: '#5B21B6', detail: '#A78BFA' }, // Purple (Void)
      { primary: '#059669', secondary: '#065F46', detail: '#34D399' }, // Green (Medic)
      { primary: '#0891B2', secondary: '#155E75', detail: '#22D3EE' }, // Cyan (Cyber)
    ];
    return palettes[hash % palettes.length];
  }, [hash]);

  return (
    <div 
      className={`relative inline-block ${isAnimated ? 'animate-bounce-slow' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Global CSS for the slow bounce if not in a global tailwind config */}
      <style jsx>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10%); }
        }
        @keyframes walk-fast {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-25%) scale(1.05); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 3s ease-in-out infinite;
        }
        .animate-walk-fast {
          animation: walk-fast 0.4s ease-in-out infinite;
        }
      `}</style>

      <svg 
        viewBox="0 0 8 8" 
        width={size} 
        height={size} 
        shapeRendering="crispEdges"
        className={`drop-shadow-[0_0_8px_rgba(37,99,235,0.3)] ${className.includes('walking') ? 'animate-walk-fast' : ''}`}
      >
        {pixels.map((row, y) => 
          row.map((pixel, x) => {
            if (!pixel) return null;
            
            // Assign color based on pixel position for detail
            let color = colors.primary;
            if ((x + y) % 3 === 0) color = colors.secondary;
            if (x >= 3 && x <= 4 && y >= 3 && y <= 4) color = colors.detail; // "The Eye"
            
            return (
              <rect 
                key={`${x}-${y}`} 
                x={x} 
                y={y} 
                width="1" 
                height="1" 
                fill={color} 
              />
            );
          })
        )}
      </svg>
      
      {/* Visual Shadow */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1/2 h-0.5 bg-black/20 blur-[1px] rounded-full" />
    </div>
  );
}
