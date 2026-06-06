import React from 'react';

interface RankBadgeProps {
  rank: string;
  size?: number;
  animate?: boolean;
  style?: React.CSSProperties;
}

export const RankBadge: React.FC<RankBadgeProps> = ({
  rank = 'Bronze',
  size = 60,
  animate = true,
  style = {}
}) => {
  const normalizedRank = rank.trim();

  // Color mapping based on CSS custom properties
  const getRankColor = (tier: string) => {
    switch (tier) {
      case 'Bronze': return '#cd7f32';
      case 'Silver': return '#c0c0c0';
      case 'Gold': return '#ffd700';
      case 'Platinum': return '#e5e4e2';
      case 'Diamond': return '#b9f2ff';
      case 'Master': return '#9b51e0';
      case 'Grand Master': return '#f2c94c';
      case 'Legend': return '#eb5757';
      case 'Mythic': return '#2d9cdb';
      case 'Titan': return '#f2994a';
      default: return '#cd7f32';
    }
  };

  const rankColor = getRankColor(normalizedRank);

  // Render SVG badge based on rank tier
  const renderBadgeSVG = () => {
    switch (normalizedRank) {
      case 'Bronze':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bronzeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#b87333" />
                <stop offset="50%" stopColor="#cd7f32" />
                <stop offset="100%" stopColor="#8b4513" />
              </linearGradient>
              <filter id="bronzeGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <circle cx="50" cy="50" r="42" fill="url(#bronzeGrad)" stroke="#5c2e0b" strokeWidth="3" filter="url(#bronzeGlow)" />
            <polygon points="50,18 58,38 80,38 62,51 69,72 50,60 31,72 38,51 20,38 42,38" fill="#ffffff" opacity="0.85" />
            <circle cx="50" cy="50" r="32" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.5" />
          </svg>
        );

      case 'Silver':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#64748b" />
              </linearGradient>
              <filter id="silverGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <path d="M50 8 L85 28 L85 62 L50 92 L15 62 L15 28 Z" fill="url(#silverGrad)" stroke="#475569" strokeWidth="3" filter="url(#silverGlow)" />
            {/* Wings */}
            <path d="M25 40 Q15 25 35 35 Q45 40 35 50" stroke="#ffffff" strokeWidth="2.5" fill="none" opacity="0.8" />
            <path d="M75 40 Q85 25 65 35 Q55 40 65 50" stroke="#ffffff" strokeWidth="2.5" fill="none" opacity="0.8" />
            <polygon points="50,30 55,45 70,45 58,55 62,70 50,60 38,70 42,55 30,45 45,45" fill="#ffffff" />
          </svg>
        );

      case 'Gold':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fffbeb" />
                <stop offset="30%" stopColor="#fbbf24" />
                <stop offset="70%" stopColor="#d97706" />
                <stop offset="100%" stopColor="#78350f" />
              </linearGradient>
              <filter id="goldGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feComponentTransfer in="blur" result="glow1">
                  <feFuncA type="linear" slope="0.8" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="glow1" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#goldGlow)">
              <path d="M50 5 L88 24 L80 68 L50 95 L20 68 L12 24 Z" fill="url(#goldGrad)" stroke="#b45309" strokeWidth="3" />
              {/* Crown Emblem */}
              <path d="M35 55 L42 40 L50 48 L58 40 L65 55 Z" fill="#ffffff" stroke="#b45309" strokeWidth="1.5" />
              <circle cx="50" cy="35" r="4" fill="#ffffff" />
              <circle cx="35" cy="55" r="2.5" fill="#ffffff" />
              <circle cx="65" cy="55" r="2.5" fill="#ffffff" />
              {/* Golden Wings */}
              <path d="M22 30 Q5 32 18 55" stroke="#ffffff" strokeWidth="2.5" fill="none" opacity="0.9" />
              <path d="M78 30 Q95 32 82 55" stroke="#ffffff" strokeWidth="2.5" fill="none" opacity="0.9" />
            </g>
          </svg>
        );

      case 'Platinum':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="platGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="40%" stopColor="#e2e8f0" />
                <stop offset="70%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <filter id="platGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <g filter="url(#platGlow)">
              <polygon points="50,5 95,50 50,95 5,50" fill="url(#platGrad)" stroke="#475569" strokeWidth="3" />
              <polygon points="50,15 80,50 50,85 20,50" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
              {/* Sci-Fi cross star */}
              <path d="M50 25 L50 75 M25 50 L75 50" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
              <circle cx="50" cy="50" r="10" fill="#ffffff" stroke="#475569" strokeWidth="2" />
            </g>
          </svg>
        );

      case 'Diamond':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="diamGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="40%" stopColor="#22d3ee" />
                <stop offset="80%" stopColor="#e0f7fa" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
              <filter id="diamGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#diamGlow)">
              {/* Gem cuts */}
              <polygon points="50,5 85,32 72,92 28,92 15,32" fill="url(#diamGrad)" stroke="#0891b2" strokeWidth="3" />
              <polygon points="50,5 50,92 28,92" fill="rgba(255,255,255,0.25)" />
              <polygon points="50,5 85,32 50,32" fill="rgba(255,255,255,0.4)" />
              <polygon points="50,5 15,32 50,32" fill="rgba(0,0,0,0.08)" />
              <polygon points="50,32 85,32 72,92 50,92" fill="rgba(255,255,255,0.15)" />
              {/* Center Diamond Sparkle */}
              {animate && (
                <path d="M50 20 L53 35 L68 38 L53 41 L50 56 L47 41 L32 38 L47 35 Z" fill="#ffffff" style={{ transformOrigin: '50px 38px' }}>
                  <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
                  <animateTransform attributeName="transform" type="scale" values="0.9;1.1;0.9" dur="2.5s" repeatCount="indefinite" />
                </path>
              )}
            </g>
          </svg>
        );

      case 'Master':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="masterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#581c87" />
              </linearGradient>
              <filter id="masterGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feComponentTransfer in="blur" result="glow">
                  <feFuncA type="linear" slope="0.9" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#masterGlow)">
              <path d="M50 5 Q80 15 90 48 Q85 80 50 95 Q15 80 10 48 Q20 15 50 5 Z" fill="url(#masterGrad)" stroke="#6b21a8" strokeWidth="3" />
              {/* Crown inside */}
              <path d="M28 60 L35 38 L44 48 L50 32 L56 48 L65 38 L72 60 Z" fill="#ffffff" stroke="#581c87" strokeWidth="2" />
              <circle cx="50" cy="50" r="18" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
              {/* Glowing circles */}
              <circle cx="50" cy="27" r="3" fill="#ffd700" />
              <circle cx="33" cy="33" r="2" fill="#ffd700" />
              <circle cx="67" cy="33" r="2" fill="#ffd700" />
            </g>
          </svg>
        );

      case 'Grand Master':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="gmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fef08a" />
                <stop offset="50%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#854d0e" />
              </linearGradient>
              <filter id="gmGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="9" result="blur" />
                <feComponentTransfer in="blur" result="boost">
                  <feFuncA type="linear" slope="1.0" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="boost" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#gmGlow)">
              {/* Dual Golden Shields */}
              <path d="M50 3 L92 22 L82 72 L50 97 L18 72 L8 22 Z" fill="url(#gmGrad)" stroke="#a16207" strokeWidth="3" />
              <path d="M50 12 L84 27 L76 66 L50 87 L24 66 L16 27 Z" fill="rgba(0,0,0,0.15)" stroke="#ffd700" strokeWidth="1.5" />
              {/* Glowing Star in center */}
              <polygon points="50,22 56,38 72,40 60,51 64,68 50,59 36,68 40,51 28,40 44,38" fill="#ffffff" stroke="#854d0e" strokeWidth="1.5">
                {animate && (
                  <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite" />
                )}
              </polygon>
              {/* GM Accent Wings */}
              <path d="M12 25 C-5 35 15 65 30 50" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M88 25 C105 35 85 65 70 50" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
            </g>
          </svg>
        );

      case 'Legend':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="legendGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7f1d1d" />
                <stop offset="50%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#f97316" />
              </linearGradient>
              <filter id="legendGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="9" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#legendGlow)">
              <circle cx="50" cy="50" r="44" fill="url(#legendGrad)" stroke="#991b1b" strokeWidth="4" />
              {/* Fiery Inner Shape */}
              <path d="M50 12 C72 12 80 40 50 85 C20 40 28 12 50 12 Z" fill="rgba(255,255,255,0.15)" stroke="#ffffff" strokeWidth="2.5" />
              {/* Flame Details */}
              <path d="M50 30 Q58 50 50 68 Q42 50 50 30 Z" fill="#ffd700" />
              <path d="M50 42 Q54 54 50 65 Q46 54 50 42 Z" fill="#ffffff" />
            </g>
          </svg>
        );

      case 'Mythic':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="mythicGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="50%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <filter id="mythicGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="10" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#mythicGlow)">
              {/* Vortex/Portal Shape */}
              <circle cx="50" cy="50" r="42" stroke="url(#mythicGrad)" strokeWidth="6" strokeDasharray="30 15" strokeLinecap="round">
                {animate && (
                  <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="8s" repeatCount="indefinite" />
                )}
              </circle>
              <circle cx="50" cy="50" r="30" stroke="#ffffff" strokeWidth="2" strokeDasharray="10 5" opacity="0.7">
                {animate && (
                  <animateTransform attributeName="transform" type="rotate" from="360 50 50" to="0 50 50" dur="6s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Mystic Core Star */}
              <polygon points="50,28 53,42 66,45 53,48 50,62 47,48 34,45 47,42" fill="#ffffff" />
              <circle cx="50" cy="45" r="4" fill="#ffffff" filter="blur(1px)" />
            </g>
          </svg>
        );

      case 'Titan':
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="titanGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ea580c" />
                <stop offset="40%" stopColor="#f59e0b" />
                <stop offset="80%" stopColor="#ffd700" />
                <stop offset="100%" stopColor="#fffdef" />
              </linearGradient>
              <filter id="titanGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="12" result="blur" />
                <feComponentTransfer in="blur" result="glow">
                  <feFuncA type="linear" slope="1.2" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#titanGlow)">
              {/* Rotating Titan Halo Ring */}
              <circle cx="50" cy="50" r="45" stroke="url(#titanGrad)" strokeWidth="3" strokeDasharray="40 10 5 10" strokeLinecap="round">
                {animate && (
                  <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="10s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Celestial Crown Shield */}
              <path d="M50 8 L82 25 L75 68 L50 92 L25 68 L18 25 Z" fill="url(#titanGrad)" stroke="#c2410c" strokeWidth="4" />
              <path d="M50 18 L74 31 L68 62 L50 82 L32 62 L26 31 Z" fill="rgba(0,0,0,0.25)" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
              {/* Divine Crown points */}
              <path d="M36 52 L43 35 L50 42 L57 35 L64 52 Z" fill="#ffffff" stroke="#c2410c" strokeWidth="2" />
              <circle cx="50" cy="30" r="3.5" fill="#ffffff" />
              <circle cx="36" cy="52" r="2.5" fill="#ffffff" />
              <circle cx="64" cy="52" r="2.5" fill="#ffffff" />
              {/* Sparkle beams */}
              <path d="M50 22 L50 58" stroke="#ffffff" strokeWidth="2" opacity="0.5" />
            </g>
          </svg>
        );

      default:
        return (
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="40" fill="#a0aec0" />
            <text x="50" y="55" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="bold">?</text>
          </svg>
        );
    }
  };

  return (
    <div 
      className={`rank-badge-container ${animate ? 'animate-float' : ''}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: `drop-shadow(0 0 8px ${rankColor}30)`,
        ...style
      }}
    >
      {renderBadgeSVG()}
    </div>
  );
};
