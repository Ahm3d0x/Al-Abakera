import React, { useState } from 'react';
import { User } from '@mind-race/shared';
import { supabase } from '../lib/supabase';

interface CosmeticShopModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  isRtl: boolean;
  refreshProfile: () => Promise<void>;
  triggerAlert: (msg: string, type: 'success' | 'error' | 'info') => void;
  playSFX: (type: 'correct' | 'wrong' | 'buzz' | 'tick' | 'slam' | 'click') => void;
}

interface ShopItem {
  key: string;
  name: { en: string; ar: string };
  desc: { en: string; ar: string };
  cost: number;
  category: 'border' | 'effect';
  preview: string; // CSS style or emoji representation
}

const COSMETICS_CATALOG: ShopItem[] = [
  {
    key: 'cyber_neon',
    name: { en: 'Cyber Neon Border', ar: 'إطار النيون السيبراني' },
    desc: { en: 'A vibrant glowing cyan avatar border.', ar: 'إطار رمز تعبيري متوهج باللون السماوي النابض بالحياة.' },
    cost: 500,
    category: 'border',
    preview: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)'
  },
  {
    key: 'gold_halo',
    name: { en: 'Gold Halo Border', ar: 'إطار الهالة الذهبية' },
    desc: { en: 'A rotating premium golden border.', ar: 'إطار ذهبي مميز مع هالة متوهجة.' },
    cost: 1500,
    category: 'border',
    preview: 'linear-gradient(135deg, #ffd700 0%, #fbbf24 100%)'
  },
  {
    key: 'dark_matter',
    name: { en: 'Dark Matter Border', ar: 'إطار المادة المظلمة' },
    desc: { en: 'A deep dark obsidian pulsing border.', ar: 'إطار داكن بنمط نبضات المادة المظلمة الغامضة.' },
    cost: 2500,
    category: 'border',
    preview: 'linear-gradient(135deg, #8b5cf6 0%, #090d16 100%)'
  },
  {
    key: 'laser_strike',
    name: { en: 'Laser Strike Effect', ar: 'تأثير ضربة الليزر' },
    desc: { en: 'A clean cyan sweep across the deck.', ar: 'مسح ضوئي ليزر أخضر وسماوي على البطاقة عند الإجابة الصحيحة.' },
    cost: 800,
    category: 'effect',
    preview: '⚡'
  },
  {
    key: 'firework',
    name: { en: 'Firework Effect', ar: 'تأثير الألعاب النارية' },
    desc: { en: 'Celebratory colorful sparkle bursts.', ar: 'انفجارات ملونة واحتفالية مبهرة عند الإجابة الصحيحة.' },
    cost: 1200,
    category: 'effect',
    preview: '🎆'
  },
  {
    key: 'matrix_rain',
    name: { en: 'Matrix Rain Effect', ar: 'تأثير مطر الماتريكس' },
    desc: { en: 'Digital falling green code matrix sweep.', ar: 'شفرات رقمية خضراء متساقطة عند الإجابة الصحيحة.' },
    cost: 2000,
    category: 'effect',
    preview: '💻'
  }
];

export const CosmeticShopModal: React.FC<CosmeticShopModalProps> = ({
  user,
  isOpen,
  onClose,
  isRtl,
  refreshProfile,
  triggerAlert,
  playSFX
}) => {
  const [activeTab, setActiveTab] = useState<'border' | 'effect'>('border');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const inventory = user.inventory || [];
  const equipped = user.equipped || { border: null, effect: null, avatar: null };

  const handleBuy = async (item: ShopItem) => {
    if (user.coins < item.cost) {
      playSFX('wrong');
      triggerAlert(isRtl ? 'ليس لديك عملات كافية!' : 'Insufficient coins!', 'error');
      return;
    }

    setLoadingKey(item.key);
    playSFX('click');

    try {
      // Get auth token from supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/store/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cosmeticKey: item.key })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Purchase failed');
      }

      playSFX('correct');
      triggerAlert(
        isRtl 
          ? `تم شراء ${item.name.ar} بنجاح!` 
          : `Successfully purchased ${item.name.en}!`, 
        'success'
      );
      await refreshProfile();
    } catch (err: unknown) {
      playSFX('wrong');
      const errMsg = err instanceof Error ? err.message : 'Error occurred';
      triggerAlert(errMsg, 'error');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleEquip = async (item: ShopItem, isEquipped: boolean) => {
    setLoadingKey(item.key);
    playSFX('click');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/v1/store/equip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          category: item.category, 
          key: isEquipped ? null : item.key 
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Equip failed');
      }

      triggerAlert(
        isRtl 
          ? (isEquipped ? 'تم إلغاء التجهيز' : 'تم التجهيز بنجاح!') 
          : (isEquipped ? 'Unequipped item' : 'Equipped successfully!'), 
        'success'
      );
      await refreshProfile();
    } catch (err: unknown) {
      playSFX('wrong');
      const errMsg = err instanceof Error ? err.message : 'Error occurred';
      triggerAlert(errMsg, 'error');
    } finally {
      setLoadingKey(null);
    }
  };

  const items = COSMETICS_CATALOG.filter(item => item.category === activeTab);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Close Button */}
        <button style={styles.closeBtn} onClick={onClose} id="shop-close-btn">✕</button>

        <div style={styles.header}>
          <h2 style={styles.title}>{isRtl ? 'متجر المظاهر' : 'Cosmetics Shop'}</h2>
          <div style={styles.currencies}>
            <span style={styles.currencyBadge}>🪙 {user.coins}</span>
            <span style={styles.currencyBadgeRare}>👑 {user.creatorTokens || 0}</span>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={styles.tabs}>
          <button 
            style={{ 
              ...styles.tabBtn, 
              borderBottom: activeTab === 'border' ? '2px solid #00f2fe' : 'none',
              color: activeTab === 'border' ? '#ffffff' : '#8a93c0'
            }}
            onClick={() => { playSFX('click'); setActiveTab('border'); }}
            id="tab-borders"
          >
            {isRtl ? 'إطارات الرمز' : 'Avatar Borders'}
          </button>
          <button 
            style={{ 
              ...styles.tabBtn, 
              borderBottom: activeTab === 'effect' ? '2px solid #00f2fe' : 'none',
              color: activeTab === 'effect' ? '#ffffff' : '#8a93c0'
            }}
            onClick={() => { playSFX('click'); setActiveTab('effect'); }}
            id="tab-effects"
          >
            {isRtl ? 'تأثيرات الإجابة' : 'Answer Effects'}
          </button>
        </div>

        {/* Items Grid */}
        <div style={styles.scrollContainer}>
          <div style={styles.itemsGrid}>
            {items.map((item) => {
              const isOwned = inventory.includes(item.key);
              const isEquipped = equipped[item.category] === item.key;
              const isLoading = loadingKey === item.key;

              return (
                <div key={item.key} style={styles.itemCard} className="glass-panel">
                  {/* Preview Box */}
                  <div style={styles.previewContainer}>
                    {item.category === 'border' ? (
                      <div style={{
                        width: '70px',
                        height: '70px',
                        borderRadius: '50%',
                        border: '4px solid transparent',
                        backgroundImage: `linear-gradient(rgba(15,18,30,1), rgba(15,18,30,1)), ${item.preview}`,
                        backgroundOrigin: 'border-box',
                        backgroundClip: 'padding-box, border-box',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2rem',
                        boxShadow: isEquipped ? '0 0 15px rgba(0, 242, 254, 0.4)' : 'none'
                      }}>
                        👤
                      </div>
                    ) : (
                      <span style={{ fontSize: '3rem', filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.25))' }}>
                        {item.preview}
                      </span>
                    )}
                  </div>

                  {/* Details */}
                  <div style={styles.itemDetails}>
                    <h3 style={styles.itemName}>{isRtl ? item.name.ar : item.name.en}</h3>
                    <p style={styles.itemDesc}>{isRtl ? item.desc.ar : item.desc.en}</p>
                  </div>

                  {/* Actions */}
                  <div style={styles.actionRow}>
                    {isOwned ? (
                      <button
                        style={{
                          ...styles.actionBtn,
                          background: isEquipped 
                            ? 'rgba(255, 59, 92, 0.15)' 
                            : 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                          border: isEquipped ? '1px solid rgba(255, 59, 92, 0.3)' : 'none',
                          color: '#ffffff'
                        }}
                        disabled={isLoading}
                        onClick={() => handleEquip(item, isEquipped)}
                      >
                        {isLoading 
                          ? '...' 
                          : (isEquipped 
                            ? (isRtl ? 'إلغاء التجهيز' : 'Unequip') 
                            : (isRtl ? 'تجهيز' : 'Equip'))}
                      </button>
                    ) : (
                      <button
                        style={{
                          ...styles.actionBtn,
                          background: 'rgba(255, 215, 0, 0.12)',
                          border: '1px solid rgba(255, 215, 0, 0.3)',
                          color: '#ffd700',
                          fontWeight: 'bold'
                        }}
                        disabled={isLoading}
                        onClick={() => handleBuy(item)}
                      >
                        {isLoading ? '...' : `🪙 ${item.cost}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(5, 6, 10, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    boxSizing: 'border-box'
  },
  modal: {
    width: '90%',
    maxWidth: '520px',
    height: '80vh',
    backgroundColor: 'rgba(15, 18, 30, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden'
  },
  closeBtn: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'none',
    border: 'none',
    color: '#8a93c0',
    fontSize: '1.2rem',
    cursor: 'pointer',
    zIndex: 10
  },
  header: {
    padding: '24px 24px 12px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)'
  },
  title: {
    fontSize: '1.4rem',
    fontWeight: 900,
    color: '#ffffff',
    margin: 0
  },
  currencies: {
    display: 'flex',
    gap: '8px'
  },
  currencyBadge: {
    fontSize: '0.85rem',
    padding: '4px 10px',
    background: 'rgba(255,179,0,0.12)',
    border: '1px solid rgba(255,179,0,0.2)',
    borderRadius: '20px',
    color: '#ffb300',
    fontWeight: 'bold'
  },
  currencyBadgeRare: {
    fontSize: '0.85rem',
    padding: '4px 10px',
    background: 'rgba(0,242,254,0.12)',
    border: '1px solid rgba(0,242,254,0.2)',
    borderRadius: '20px',
    color: '#00f2fe',
    fontWeight: 'bold'
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    background: 'rgba(0, 0, 0, 0.15)'
  },
  tabBtn: {
    flex: 1,
    padding: '14px',
    background: 'none',
    border: 'none',
    fontSize: '0.9rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  scrollContainer: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1
  },
  itemsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  itemCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    border: '1px solid rgba(255,255,255,0.03)',
    borderRadius: '12px',
    gap: '16px'
  },
  previewContainer: {
    width: '80px',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.25)',
    borderRadius: '8px'
  },
  itemDetails: {
    flex: 1
  },
  itemName: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#ffffff',
    margin: '0 0 4px 0'
  },
  itemDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    margin: 0,
    lineHeight: 1.3
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center'
  },
  actionBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: '90px',
    transition: 'all 0.1s'
  }
};
