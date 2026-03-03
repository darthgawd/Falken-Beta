'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CyberDrone } from './CyberDrone';
import { FalconIcon } from './FalconIcon';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface RoamingAgent {
  id: string;
  address: string;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  altitude: number;
  state: 'RUSH' | 'WANDER' | 'IDLE';
  nextActionTime: number;
}

export function FalklandMap() {
  const [matches, setMatches] = useState<MatchNode[]>([]);
  const [roamingAgents, setRoamingAgents] = useState<RoamingAgent[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);

  // 1. Initialize Roaming Agents (15 total for a true swarm)
  useEffect(() => {
    const addresses = [
      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1', '0x1afb0ad5944570106c7a6452f20d18320498b58a',
      '0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4', '0x8e8048213960b8a1126cB56FaF8085DccE35DAc0',
      '0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4', '0xF32BF92fcd1C07F515Ee82D4169c8B5dF4eD6bA8',
      '0x2b04fE68e3f3B8F14Dc04C7E42563197F27Fa84E', '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      '0x41B720822a1608677e4e892cbeD71408899876Fa', '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
      '0xdd2fd4581271e230360230f9337d5c0430bf44c0'
    ];
    
    const agents: RoamingAgent[] = addresses.map((addr, i) => ({
      id: `scout-${i + 1}`,
      address: addr,
      currentX: Math.random() * 14,
      currentY: Math.random() * 14,
      targetX: Math.random() * 14,
      targetY: Math.random() * 14,
      vx: 0,
      vy: 0,
      altitude: 100 + Math.random() * 40,
      state: Math.random() > 0.5 ? 'RUSH' : 'WANDER',
      nextActionTime: Date.now() + Math.random() * 5000
    }));
    setRoamingAgents(agents);
  }, []);

  // 2. Animate Swarm (Steering Physics)
  useEffect(() => {
    let frameId: number;
    const move = () => {
      const now = Date.now();
      setRoamingAgents(prev => prev.map(agent => {
        let { currentX, currentY, targetX, targetY, vx, vy, state, nextActionTime, altitude } = agent;

        // State Transitions
        if (now > nextActionTime) {
          const rand = Math.random();
          if (rand < 0.2) {
            state = 'IDLE';
            nextActionTime = now + 1000 + Math.random() * 2000;
          } else if (rand < 0.6) {
            state = 'WANDER';
            targetX = Math.random() * 14;
            targetY = Math.random() * 14;
            nextActionTime = now + 2000 + Math.random() * 4000;
          } else {
            state = 'RUSH';
            targetX = Math.random() * 14;
            targetY = Math.random() * 14;
            nextActionTime = now + 1000 + Math.random() * 2000;
          }
        }

        // Steering Force
        const dx = targetX - currentX;
        const dy = targetY - currentY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let forceX = 0;
        let forceY = 0;

        if (state !== 'IDLE' && dist > 0.1) {
          const speedFactor = state === 'RUSH' ? 0.008 : 0.003;
          forceX = (dx / dist) * speedFactor;
          forceY = (dy / dist) * speedFactor;
        }

        // Add some "Swarm Drift" (Brownian motion)
        forceX += (Math.random() - 0.5) * 0.002;
        forceY += (Math.random() - 0.5) * 0.002;

        // Apply Physics
        vx = (vx + forceX) * 0.96; // 0.96 = friction/damping
        vy = (vy + forceY) * 0.96;

        // Dynamic Altitude Drift
        const newAltitude = altitude + Math.sin(now / 500 + Number(agent.id.split('-')[1])) * 0.5;

        // Keep inside bounds
        let newX = currentX + vx;
        let newY = currentY + vy;
        if (newX < 0 || newX > 14) { vx *= -1; newX = currentX; }
        if (newY < 0 || newY > 14) { vy *= -1; newY = currentY; }

        return {
          ...agent,
          currentX: newX,
          currentY: newY,
          vx,
          vy,
          state,
          nextActionTime,
          altitude: newAltitude
        };
      }));
      frameId = requestAnimationFrame(move);
    };
    frameId = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // 3. Fetch live matches...
  useEffect(() => {
    const fetchMatches = async () => {
      const { data } = await supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40);

      const houseNode: MatchNode = {
        id: 'HOUSE_COMMAND',
        x: 7,
        y: 7,
        playerA: '0x0000000000000000000000000000000000000000',
        playerB: '0x0000000000000000000000000000000000000000',
        stake: '0',
        status: 'HOUSE'
      };

      if (data && data.length > 0) {
        const mapped = data.map((m: any) => {
          const h = (str: string) => {
            let res = 0;
            for (let i = 0; i < str.length; i++) res = ((res << 5) - res) + str.charCodeAt(i);
            return Math.abs(res);
          };
          const hash = h(m.match_id);
          return {
            id: m.match_id,
            x: hash % 15,
            y: (hash >> 8) % 15,
            playerA: m.player_a,
            playerB: m.player_b,
            stake: m.stake_wei || '0',
            status: m.status
          };
        });
        setMatches([houseNode, ...mapped]);
      } else {
        setMatches([houseNode]);
      }
    };

    fetchMatches();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('falkland-map')
      .on('postgres_changes', { event: '*', table: 'matches' }, fetchMatches)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="relative w-full h-[700px] bg-[#020205] overflow-hidden border border-zinc-800 rounded-3xl shadow-2xl shadow-black">
      {/* Background Ambience - Brighter */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.15)_0%,transparent_100%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(37,99,235,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.2) 1px, transparent 1px)', backgroundSize: '50px 50px' }} />

      {/* The Isometric Container */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div 
          className="relative w-[1200px] h-[1200px] pointer-events-auto"
          style={{ 
            transform: 'rotateX(55deg) rotateZ(45deg) scale(0.9)',
            transformStyle: 'preserve-3d'
          }}
        >
          {/* Base Glow */}
          <div className="absolute inset-0 bg-blue-600/5 blur-[100px] rounded-full" />

          {/* Grid Lines - Much Brighter */}
          <div className="absolute inset-0 grid grid-cols-15 grid-rows-15 border-2 border-blue-500/20 shadow-[0_0_50px_rgba(37,99,235,0.1)]">
            {Array.from({ length: 225 }).map((_, i) => (
              <div key={i} className="border-[1px] border-blue-500/10 hover:bg-blue-500/20 transition-all duration-300 relative group">
                {/* Glowing intersections */}
                <div className="absolute -top-0.5 -left-0.5 w-1 h-1 bg-blue-400/30 rounded-full blur-[1px]" />
              </div>
            ))}
          </div>

          {/* Render Roaming Agents */}
          {roamingAgents.map((agent) => (
            <div 
              key={agent.id}
              className="absolute z-[150] transition-transform duration-100 ease-linear pointer-events-auto cursor-crosshair"
              onMouseEnter={() => setHoveredAgentId(agent.id)}
              onMouseLeave={() => setHoveredAgentId(null)}
              style={{ 
                left: `${(agent.currentX / 15) * 100}%`, 
                top: `${(agent.currentY / 15) * 100}%`,
                width: '6.6%',
                height: '6.6%',
                transform: `translateZ(${agent.altitude}px)`,
                transformStyle: 'preserve-3d'
              }}
            >
              {/* Agent Sprite */}
              <div style={{ transform: 'rotateZ(-45deg) rotateX(-55deg)' }}>
                <CyberDrone address={agent.address} size={32} className={agent.state !== 'IDLE' ? 'walking' : ''} />
                
                {/* Agent Tag */}
                <div className="absolute top-10 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/50 border border-zinc-800 rounded text-[7px] font-black text-blue-500 uppercase tracking-widest whitespace-nowrap">
                  {agent.state === 'RUSH' ? 'RUSHING' : agent.state === 'WANDER' ? 'WANDERING' : 'IDLING'}
                </div>

                {/* Agent Intelligence Lens (Hover Panel) */}
                {hoveredAgentId === agent.id && (
                  <div 
                    className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-48 p-3 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700 rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] z-[200] animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none"
                    style={{ transform: 'translateY(-20px)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        <p className="text-[10px] font-black text-white uppercase tracking-widest">AGENT_INTEL</p>
                      </div>
                      <span className="text-[8px] font-bold text-blue-500/50 uppercase">v2.5.1</span>
                    </div>

                    <div className="space-y-2.5 border-t border-zinc-800 pt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">Address</span>
                        <span className="text-[9px] font-mono text-zinc-400 truncate w-24 text-right">{agent.address}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">Reasoning</span>
                        <span className="text-[9px] font-black text-blue-400 uppercase italic tracking-tighter">
                          {agent.id.charCodeAt(6) % 3 === 0 ? 'Gemini 2.5' : (agent.id.charCodeAt(6) % 3 === 1 ? 'GPT-4o' : 'Claude 3.5')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-1.5 bg-black/40 border border-zinc-800 rounded-lg">
                          <p className="text-[8px] font-bold text-zinc-600 uppercase">ELO</p>
                          <p className="text-xs font-black text-white italic">{1400 + (agent.id.charCodeAt(6) % 600)}</p>
                        </div>
                        <div className="p-1.5 bg-black/40 border border-zinc-800 rounded-lg">
                          <p className="text-[8px] font-bold text-zinc-600 uppercase">WIN_RATE</p>
                          <p className="text-xs font-black text-green-500 italic">{55 + (agent.id.charCodeAt(6) % 40)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Ground Glow for Roamer */}
              <div 
                className={`absolute inset-[-100%] rounded-full blur-2xl transition-all duration-1000 ${agent.state === 'RUSH' ? 'bg-blue-400/20' : 'bg-blue-600/10'}`} 
                style={{ transform: `translateZ(-${agent.altitude}px)` }}
              />
            </div>
          ))}

          {/* Render Match Nodes */}
          {matches.map((node) => (
            <div 
              key={node.id}
              className="absolute group transition-all duration-700"
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                left: `${(node.x / 15) * 100}%`, 
                top: `${(node.y / 15) * 100}%`,
                width: '6.6%',
                height: '6.6%',
                transform: 'translateZ(0px)',
                transformStyle: 'preserve-3d',
                zIndex: hoveredNode === node.id ? 100 : 10
              }}
            >
              {/* Ground Glow for Entity */}
              <div className={`absolute inset-[-50%] rounded-full blur-2xl transition-opacity duration-1000 ${node.status === 'HOUSE' ? 'bg-gold/20' : 'bg-blue-600/30'}`} />

              {/* The "Tower" representing the match */}
              <div 
                className={`absolute inset-1 border-l border-t transition-all duration-700 ${
                  node.status === 'HOUSE' 
                    ? 'bg-gradient-to-t from-gold/60 to-gold/20 border-gold/40 shadow-[0_0_30px_rgba(234,179,8,0.3)]' 
                    : node.status === 'ACTIVE'
                    ? 'bg-gradient-to-t from-blue-600/60 to-blue-400/20 border-blue-400/40 animate-pulse'
                    : 'bg-gradient-to-t from-zinc-800/60 to-zinc-800/20 border-zinc-700/40 opacity-50 grayscale'
                }`}
                style={{ 
                  transform: `translateZ(${node.status === 'HOUSE' ? '80px' : (node.status === 'ACTIVE' ? '60px' : '15px')})`,
                  transformStyle: 'preserve-3d',
                }}
              >
                {/* Visual "Cap" on the tower */}
                <div className={`absolute -top-[1px] -left-[1px] w-full h-full border ${node.status === 'HOUSE' ? 'border-gold/60 bg-gold/30' : 'border-blue-400/60 bg-blue-500/30'}`} />
                
                {/* Beacon Light for House */}
                {node.status === 'HOUSE' && (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-32 bg-gold/50 blur-md animate-pulse" />
                )}
              </div>

              {/* Player Avatars around the match */}
              {node.playerA && node.playerA !== '0x0000000000000000000000000000000000000000' && (
                <div className="absolute -left-6 -top-6" style={{ transform: 'translateZ(100px) rotateZ(-45deg) rotateX(-60deg)' }}>
                  <CyberDrone address={node.playerA} size={32} />
                </div>
              )}
              {node.playerB && node.playerB !== '0x0000000000000000000000000000000000000000' && (
                <div className="absolute -right-6 -bottom-6" style={{ transform: 'translateZ(100px) rotateZ(-45deg) rotateX(-60deg)' }}>
                  <CyberDrone address={node.playerB} size={32} />
                </div>
              )}

              {/* House Identity */}
              {node.status === 'HOUSE' && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ transform: 'translateZ(120px) rotateZ(-45deg) rotateX(-60deg)' }}>
                  <FalconIcon className="w-8 h-8 text-gold drop-shadow-[0_0_15px_rgba(234,179,8,1)]" color="currentColor" />
                </div>
              )}

              {/* Hover Info Panel (Intelligence Lens) */}
              {hoveredNode === node.id && (
                <div 
                  className="absolute left-full ml-8 w-64 p-4 bg-black/90 backdrop-blur-2xl border border-zinc-700 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] z-[200] animate-in fade-in slide-in-from-left-4 duration-300 pointer-events-none"
                  style={{ transform: 'rotateZ(-45deg) rotateX(-55deg) translateY(-100px)' }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-2 h-2 rounded-full animate-pulse ${node.status === 'HOUSE' ? 'bg-gold' : 'bg-blue-500'}`} />
                    <p className="text-xs font-black text-white uppercase tracking-widest">
                      {node.status === 'HOUSE' ? 'HOUSE_PROTOCOL_CORE' : 'COMBAT_VECT_ACTIVE'}
                    </p>
                  </div>
                  
                  <div className="space-y-3 border-t border-zinc-800 pt-3">
                    <div className="flex justify-between">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Registry_ID</span>
                      <span className="text-[10px] font-mono text-zinc-300 truncate w-32 text-right">{node.id}</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Total Stake</p>
                        <p className="text-lg font-black text-gold uppercase tracking-tighter italic leading-none">
                          {(Number(node.stake) / 1e18).toFixed(4)} $FALK
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Status</p>
                        <p className={`text-xs font-black ${node.status === 'ACTIVE' ? 'text-green-500' : (node.status === 'HOUSE' ? 'text-gold' : 'text-zinc-500')} uppercase`}>
                          {node.status}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>


      {/* UI Overlays */}
      <div className="absolute top-6 left-6 flex items-center gap-3">
        <div className="p-2 bg-blue-600/10 border border-blue-500/20 rounded-lg">
          <FalconIcon className="w-5 h-5 text-blue-500" color="currentColor" />
        </div>
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-[0.2em] italic">Falkland Arena</h2>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Real-time Strategic Observability</p>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 text-right">
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Arena Population</p>
        <p className="text-xs font-mono text-blue-500">{matches.length} Entities Detected</p>
      </div>
    </div>
  );
}
