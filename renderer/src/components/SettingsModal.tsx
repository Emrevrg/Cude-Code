import React, { useState, useEffect } from 'react';
import type { ProviderInfo, BudgetStatus } from '../types/ipc';
import { useConfig } from '../hooks/useConfig';

interface SettingsModalProps {
  onClose: () => void;
}

type Tab = 'providers' | 'budget' | 'preferences';

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { config, setApiKey, setSetting, refresh: refreshConfig } = useConfig();
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});

  // Budget inputs
  const [totalLimitInput, setTotalLimitInput] = useState('');
  const [monthlyLimitInput, setMonthlyLimitInput] = useState('');

  useEffect(() => {
    window.codiente.providers.list().then(setProviders).catch(() => {});
    window.codiente.budget.status().then(b => {
      setBudget(b);
      setTotalLimitInput(b.totalLimit !== undefined ? String(b.totalLimit) : '');
      setMonthlyLimitInput(b.monthlyLimit !== undefined ? String(b.monthlyLimit) : '');
    }).catch(() => {});
  }, []);

  const handleSaveKey = async (provider: string) => {
    const key = apiKeyInputs[provider]?.trim();
    if (!key) return;
    setSaving(provider);
    try {
      await setApiKey(provider, key);
      setApiKeyInputs(prev => ({ ...prev, [provider]: '' }));
      const updated = await window.codiente.providers.list();
      setProviders(updated);
    } finally {
      setSaving(null);
    }
  };

  const handleSetBudget = async (monthly: boolean) => {
    const input = monthly ? monthlyLimitInput : totalLimitInput;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) return;
    setSaving(monthly ? 'monthly' : 'total');
    try {
      await window.codiente.budget.set(amount, monthly);
      const updated = await window.codiente.budget.status();
      setBudget(updated);
    } finally {
      setSaving(null);
    }
  };

  const handleSetDefaultProvider = async (provider: string) => {
    await setSetting('defaultProvider', provider);
  };

  const handleSetDefaultModel = async (model: string) => {
    await setSetting('defaultModel', model);
  };

  const keyProviders = providers.filter(p =>
    ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'nvidia', 'mistral', 'together', 'perplexity', 'deepseek', 'xai', 'cohere'].includes(p.name)
  );
  const localProviders = providers.filter(p => p.name === 'ollama');

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        className="animate-scale-in"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-xl)',
          width: '100%',
          maxWidth: 680,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <h2 style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 600 }}>Settings</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 18,
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            padding: '12px 24px 0',
            gap: 4,
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {(['providers', 'budget', 'preferences'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--accent-1)' : '2px solid transparent',
                padding: '8px 16px',
                cursor: 'pointer',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: tab === t ? 500 : 400,
                transition: 'all 0.12s',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {tab === 'providers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>
                Configure API keys to connect to AI providers. Keys are stored locally in ~/.codiente/
              </p>

              {keyProviders.map(p => (
                <ProviderKeyRow
                  key={p.name}
                  provider={p}
                  keyValue={apiKeyInputs[p.name] ?? ''}
                  onKeyChange={v => setApiKeyInputs(prev => ({ ...prev, [p.name]: v }))}
                  onSave={() => handleSaveKey(p.name)}
                  saving={saving === p.name}
                />
              ))}

              {localProviders.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Local Providers
                  </p>
                  {localProviders.map(p => (
                    <div
                      key={p.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StatusDot configured={p.configured} />
                        <div>
                          <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 }}>{p.displayName}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                            {p.configured ? 'Running locally' : 'Not detected — install and run Ollama'}
                          </div>
                        </div>
                      </div>
                      <span style={{
                        background: 'rgba(16, 185, 129, 0.12)',
                        color: 'var(--success)',
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                      }}>
                        Free
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'budget' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Set spending limits to control your AI costs. Limits are enforced across all providers.
              </p>

              {/* Current spending */}
              {budget && (
                <div
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 16,
                  }}
                >
                  <SpendStat label="Total Spent" value={`$${budget.totalSpent.toFixed(4)}`} />
                  <SpendStat label="This Month" value={`$${budget.monthlySpent.toFixed(4)}`} />
                  <SpendStat label="This Session" value={`$${budget.sessionSpent.toFixed(4)}`} />
                </div>
              )}

              {/* Set total limit */}
              <BudgetLimitInput
                label="Total Spending Limit"
                description="Hard cap on total all-time spending"
                value={totalLimitInput}
                onChange={setTotalLimitInput}
                onSave={() => handleSetBudget(false)}
                saving={saving === 'total'}
                current={budget?.totalLimit}
              />

              {/* Set monthly limit */}
              <BudgetLimitInput
                label="Monthly Spending Limit"
                description="Resets at the start of each month"
                value={monthlyLimitInput}
                onChange={setMonthlyLimitInput}
                onSave={() => handleSetBudget(true)}
                saving={saving === 'monthly'}
                current={budget?.monthlyLimit}
              />
            </div>
          )}

          {tab === 'preferences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Configure default behavior for new chat sessions.
              </p>

              {/* Default provider */}
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                  Default Provider
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {providers.filter(p => p.configured).map(p => (
                    <button
                      key={p.name}
                      onClick={() => handleSetDefaultProvider(p.name)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid',
                        borderColor: config?.defaultProvider === p.name ? 'var(--accent-1)' : 'var(--border)',
                        background: config?.defaultProvider === p.name ? 'rgba(124, 58, 237, 0.12)' : 'var(--bg-card)',
                        color: config?.defaultProvider === p.name ? 'var(--accent-1)' : 'var(--text-secondary)',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                    >
                      {p.displayName}
                    </button>
                  ))}
                  {providers.filter(p => p.configured).length === 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Configure a provider first</span>
                  )}
                </div>
              </div>

              {/* Default model */}
              {config?.defaultProvider && (
                <div>
                  <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                    Default Model
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(providers.find(p => p.name === config.defaultProvider)?.models ?? []).map(m => (
                      <button
                        key={m.id}
                        onClick={() => handleSetDefaultModel(m.id)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-xl)',
                          border: '1px solid',
                          borderColor: config?.defaultModel === m.id ? 'var(--accent-2)' : 'var(--border)',
                          background: config?.defaultModel === m.id ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-card)',
                          color: config?.defaultModel === m.id ? 'var(--accent-2)' : 'var(--text-secondary)',
                          fontSize: 12,
                          cursor: 'pointer',
                          transition: 'all 0.12s',
                        }}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Config path info */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                }}
              >
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  Configuration stored at: <code style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>~/.codiente/</code>
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                  Shared with the CLI — changes here apply to <code style={{ fontFamily: 'monospace' }}>codiente chat</code> as well.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProviderKeyRowProps {
  provider: ProviderInfo;
  keyValue: string;
  onKeyChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}

function ProviderKeyRow({ provider, keyValue, onKeyChange, onSave, saving }: ProviderKeyRowProps) {
  const [show, setShow] = useState(false);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot configured={provider.configured} />
          <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 }}>{provider.displayName}</span>
        </div>
        {provider.configured && (
          <span style={{
            background: 'rgba(16, 185, 129, 0.12)',
            color: 'var(--success)',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
          }}>
            Configured ✓
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type={show ? 'text' : 'password'}
            value={keyValue}
            onChange={e => onKeyChange(e.target.value)}
            placeholder={provider.configured ? '••••••••••••••••••••' : `Enter ${provider.displayName} API key`}
            style={{
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 36px 8px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              fontFamily: keyValue ? 'monospace' : 'inherit',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-1)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            onKeyDown={e => e.key === 'Enter' && onSave()}
          />
          <button
            onClick={() => setShow(v => !v)}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {show ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <button
          className="gradient-btn"
          onClick={onSave}
          disabled={!keyValue.trim() || saving}
          style={{
            borderRadius: 'var(--radius-sm)',
            padding: '8px 16px',
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

interface BudgetLimitInputProps {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  current?: number;
}

function BudgetLimitInput({ label, description, value, onChange, onSave, saving, current }: BudgetLimitInputProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{description}</div>
        {current !== undefined && (
          <div style={{ color: 'var(--accent-2)', fontSize: 12, marginTop: 3 }}>
            Current: ${current.toFixed(2)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            fontSize: 14,
          }}>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="0.00"
            style={{
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px 8px 24px',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-1)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            onKeyDown={e => e.key === 'Enter' && onSave()}
          />
        </div>
        <button
          className="gradient-btn"
          onClick={onSave}
          disabled={!value || isNaN(parseFloat(value)) || saving}
          style={{ borderRadius: 'var(--radius-sm)', padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
        >
          {saving ? 'Setting...' : 'Set Limit'}
        </button>
      </div>
    </div>
  );
}

function StatusDot({ configured }: { configured: boolean }) {
  return (
    <div style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: configured ? 'var(--success)' : 'var(--text-muted)',
      flexShrink: 0,
    }} />
  );
}

function SpendStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 600, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}
