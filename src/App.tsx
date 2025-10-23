import React, { useEffect, useMemo, useRef, useState } from 'react';
import SliderInput from './components/SliderInput';
import type {
  SimulationParameters,
  SimulationResult,
  PolicyMilestone,
} from './simulation/monteCarlo';
import type { SimulationWorkerResponse } from './workers/simulationWorker';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface Preset {
  id: string;
  name: string;
  params: Partial<SimulationParameters>;
  description: string;
}

const PRESETS: Preset[] = [
  {
    id: 'early',
    name: 'Early Stage',
    description: 'Fast growth, higher volatility and churn dispersion.',
    params: {
      baseGrowthMean: 0.06,
      growthVolatility: 0.08,
      churnAlpha: 2.5,
      churnBeta: 50,
      arpu: 20,
      valuationMultiple: 5.5,
      customerAcquisitionCost: 320,
      exitMonth: 48,
    },
  },
  {
    id: 'mid',
    name: 'Mid Stage',
    description: 'Balanced growth with improving unit economics.',
    params: {
      baseGrowthMean: 0.03,
      growthVolatility: 0.04,
      churnAlpha: 4,
      churnBeta: 120,
      arpu: 30,
      valuationMultiple: 6.5,
      customerAcquisitionCost: 400,
      exitMonth: 42,
    },
  },
  {
    id: 'late',
    name: 'Late Stage',
    description: 'Mature growth, tighter churn variance, premium multiples.',
    params: {
      baseGrowthMean: 0.015,
      growthVolatility: 0.025,
      churnAlpha: 6,
      churnBeta: 220,
      arpu: 40,
      valuationMultiple: 7.5,
      customerAcquisitionCost: 520,
      exitMonth: 36,
    },
  },
];

const DEFAULT_PARAMETERS: SimulationParameters = {
  seed: 'exit-modeler',
  months: 72,
  trials: 5000,
  initialMrr: 150_000,
  baseGrowthMean: 0.03,
  growthVolatility: 0.05,
  churnAlpha: 4,
  churnBeta: 120,
  arpu: 30,
  valuationMultiple: 6,
  profitTakeRate: 0.25,
  grossMargin: 0.78,
  exitStrategy: 'ma',
  exitMonth: 42,
  escrowRate: 0.1,
  escrowMonths: 12,
  earnOutRate: 0.15,
  earnOutMonths: 24,
  earnOutGrowthTarget: 0.25,
  transactionCostRate: 0.05,
  workingCapitalRate: 0.02,
  ipoFloatPercent: 0.18,
  ipoDiscount: 0.12,
  ipoFeesRate: 0.07,
  ipoLockupMonths: 12,
  postLockupSellDown: 0.35,
  policyBand: 0.2,
  milestoneTargets: [12_300_000, 250_000_000, 2_500_000_000],
  customerAcquisitionCost: 400,
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const ratioFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const App: React.FC = () => {
  const [formParameters, setFormParameters] = useState<SimulationParameters>(DEFAULT_PARAMETERS);
  const [parameters, setParameters] = useState<SimulationParameters>(DEFAULT_PARAMETERS);
  const [activePreset, setActivePreset] = useState<string | null>('mid');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const requestIdRef = useRef(0);

  const worker = useMemo(
    () => new Worker(new URL('./workers/simulationWorker.ts', import.meta.url), { type: 'module' }),
    []
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      if (event.data.requestId === requestIdRef.current) {
        setResult(event.data.result);
        setIsRunning(false);
      }
    };

    worker.addEventListener('message', handleMessage);

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
    };
  }, [worker]);

  const updateParameters = (
    partial: Partial<SimulationParameters>,
    options: { preservePreset?: boolean } = {}
  ) => {
    let nextParams: SimulationParameters | null = null;
    setFormParameters((prev) => {
      const next: SimulationParameters = { ...prev, ...partial };
      if (next.months < 0) {
        next.months = 0;
      }
      if (partial.months !== undefined && next.exitMonth > partial.months) {
        next.exitMonth = partial.months;
      }
      if (partial.exitMonth !== undefined && partial.exitMonth > next.months) {
        next.exitMonth = next.months;
      }
      if (next.exitMonth < 0) {
        next.exitMonth = 0;
      }
      if (partial.milestoneTargets !== undefined) {
        next.milestoneTargets = [...partial.milestoneTargets].sort((a, b) => a - b);
      }
      nextParams = next;
      return next;
    });
    if (!options.preservePreset) {
      setActivePreset(null);
    }
    if (nextParams) {
      setHasPendingChanges(JSON.stringify(nextParams) !== JSON.stringify(parameters));
    }
  };

  const handlePreset = (presetId: string) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    updateParameters(preset.params, { preservePreset: true });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(formParameters, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'exit-modeler-settings.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const imported = JSON.parse(String(loadEvent.target?.result));
        updateParameters(imported);
      } catch (error) {
        console.error('Invalid settings file', error);
      }
    };
    reader.readAsText(file);
  };

  const handleMilestoneChange = (index: number, value: number) => {
    updateParameters({
      milestoneTargets: formParameters.milestoneTargets.map((target, idx) => (idx === index ? value : target)),
    });
  };

  const addMilestone = () => {
    updateParameters({ milestoneTargets: [...formParameters.milestoneTargets, 1_000_000_000] });
  };

  const removeMilestone = (index: number) => {
    if (formParameters.milestoneTargets.length <= 1) return;
    updateParameters({
      milestoneTargets: formParameters.milestoneTargets.filter((_, idx) => idx !== index),
    });
  };

  const runSimulation = () => {
    setHasPendingChanges(false);
    setParameters({ ...formParameters });
  };

  useEffect(() => {
    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;
    setIsRunning(true);
    worker.postMessage({ type: 'run', requestId: nextRequestId, payload: parameters });
  }, [parameters, worker]);

  const months = result?.mrr.map((series) => `M${series.month}`) ?? [];

  const mrrChartData = useMemo(() => {
    if (!result) return null;
    return {
      labels: months,
      datasets: [
        {
          label: 'MRR p90',
          data: result.mrr.map((point) => point.p90),
          fill: false,
          backgroundColor: 'rgba(15, 98, 254, 0.08)',
          borderColor: 'rgba(15, 98, 254, 0.4)',
          borderWidth: 1,
          pointRadius: 0,
        },
        {
          label: 'MRR p10',
          data: result.mrr.map((point) => point.p10),
          fill: '-1',
          backgroundColor: 'rgba(15, 98, 254, 0.08)',
          borderColor: 'rgba(15, 98, 254, 0.15)',
          borderWidth: 1,
          pointRadius: 0,
        },
        {
          label: 'MRR Median',
          data: result.mrr.map((point) => point.median),
          borderColor: '#0f62fe',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [months, result]);

  const valuationData = useMemo(() => {
    if (!result) return null;
    const ratioValue = Number.isFinite(result.unitEconomics.ltvToCac)
      ? result.unitEconomics.ltvToCac
      : null;
    return {
      labels: months,
      datasets: [
        {
          label: 'Valuation Median',
          data: result.valuation.map((point) => point.median),
          borderColor: '#30b0a7',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'LTV:CAC Ratio',
          data: result.valuation.map(() => ratioValue),
          borderColor: '#ff7f50',
          borderDash: [8, 6],
          tension: 0,
          pointRadius: 0,
          yAxisID: 'ratio',
          hidden: ratioValue === null,
        },
      ],
    };
  }, [months, result]);

  const liquidityData = useMemo(() => {
    if (!result) return null;
    const payback = Number.isFinite(result.unitEconomics.cacPaybackMonths)
      ? result.unitEconomics.cacPaybackMonths
      : null;
    return {
      labels: months,
      datasets: [
        {
          label: 'Treasury Median',
          data: result.treasury.map((point) => point.median),
          borderColor: '#f1c21b',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Liquid Cash Median',
          data: result.liquidCash.map((point) => point.median),
          borderColor: '#8a3ffc',
          tension: 0.3,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'CAC Payback (months)',
          data: result.liquidCash.map(() => payback),
          borderColor: '#e74c3c',
          borderDash: [4, 4],
          pointRadius: 0,
          yAxisID: 'economics',
          hidden: payback === null,
        },
      ],
    };
  }, [months, result]);

  const renderPolicyBadge = (milestone: PolicyMilestone) => {
    switch (milestone.status) {
      case 'ahead':
        return <span className="status ahead">Ahead</span>;
      case 'on_track':
        return <span className="status on-track">On track</span>;
      case 'behind':
        return <span className="status behind">Behind</span>;
      default:
        return <span className="status missed">Missed</span>;
    }
  };

  return (
    <div className="app-shell">
      <header>
        <h1>SaaS Exit Modeler</h1>
        <p>
          Local Monte Carlo simulator for SaaS growth, valuation bands, decision policy guidance, and
          exit proceeds.
        </p>
      </header>

      <main>
        <section className="panel" aria-label="Controls">
          <h2>Scenario Controls</h2>

          <div className="section">
            <h3>Presets</h3>
            <div className="presets" role="group" aria-label="Scenario presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={preset.id === activePreset ? 'active' : ''}
                  onClick={() => handlePreset(preset.id)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="section">
            <h3>Growth & Revenue</h3>
            <div className="controls-grid">
              <SliderInput
                label="Initial MRR"
                description="Starting monthly recurring revenue today"
                min={0}
                max={1_000_000}
                value={formParameters.initialMrr}
                onChange={(value) => updateParameters({ initialMrr: value })}
                format={(value) => currencyFormatter.format(value)}
                scale="log"
              />
              <SliderInput
                label="ARPU"
                description="Average revenue per paying customer"
                min={0}
                max={1_000}
                step={1}
                value={formParameters.arpu}
                onChange={(value) => updateParameters({ arpu: value })}
                format={(value) => currencyFormatter.format(value)}
              />
              <SliderInput
                label="Average Monthly Growth"
                description="Expected monthly growth rate before randomness"
                min={0}
                max={0.2}
                step={0.005}
                value={Number(formParameters.baseGrowthMean.toFixed(4))}
                onChange={(value) => updateParameters({ baseGrowthMean: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={1}
              />
              <SliderInput
                label="Growth Volatility"
                description="How much monthly growth can swing"
                min={0}
                max={0.3}
                step={0.005}
                value={Number(formParameters.growthVolatility.toFixed(4))}
                onChange={(value) => updateParameters({ growthVolatility: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={1}
              />
            </div>
          </div>

          <div className="section">
            <h3>Retention & Unit Economics</h3>
            <div className="controls-grid">
              <SliderInput
                label="Churn Alpha"
                description="How spiky monthly churn swings are"
                min={0}
                max={12}
                step={0.5}
                value={formParameters.churnAlpha}
                onChange={(value) => updateParameters({ churnAlpha: value })}
                format={(value) => value.toFixed(1)}
              />
              <SliderInput
                label="Churn Beta"
                description="Typical monthly churn level"
                min={0}
                max={400}
                step={5}
                value={formParameters.churnBeta}
                onChange={(value) => updateParameters({ churnBeta: value })}
                format={(value) => value.toFixed(0)}
              />
              <SliderInput
                label="Gross Margin"
                description="Share of revenue kept after direct costs"
                min={0}
                max={1}
                step={0.005}
                value={Number(formParameters.grossMargin.toFixed(3))}
                onChange={(value) => updateParameters({ grossMargin: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={0}
              />
              <SliderInput
                label="Profit Take"
                description="Percent of gross profit saved for treasury"
                min={0}
                max={1}
                step={0.01}
                value={Number(formParameters.profitTakeRate.toFixed(3))}
                onChange={(value) => updateParameters({ profitTakeRate: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={0}
              />
              <SliderInput
                label="Customer Acquisition Cost"
                description="Average cost to acquire a new customer"
                min={0}
                max={2_000}
                value={formParameters.customerAcquisitionCost}
                onChange={(value) => updateParameters({ customerAcquisitionCost: value })}
                format={(value) => currencyFormatter.format(value)}
                scale="log"
              />
            </div>
          </div>

          <div className="section">
            <h3>Simulation Engine</h3>
            <div className="controls-grid">
              <SliderInput
                label="Months"
                description="How many months to simulate"
                min={0}
                max={120}
                step={1}
                value={formParameters.months}
                onChange={(value) => updateParameters({ months: value })}
                format={(value) => `${value}`}
              />
              <SliderInput
                label="Trials"
                description="How many random scenarios to run"
                min={0}
                max={20_000}
                value={formParameters.trials}
                onChange={(value) => updateParameters({ trials: value })}
                format={(value) => value.toLocaleString()}
                scale="log"
              />
              <div className="control-row">
                <label>
                  RNG Seed
                  <small>Deterministic seed for reproducibility</small>
                </label>
                <div className="text-input">
                  <input
                    type="text"
                    value={formParameters.seed}
                    onChange={(event) => updateParameters({ seed: event.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <h3>Exit Strategy</h3>
            <div className="control-row">
              <label>
                Strategy
                <small>Switch between M&amp;A and IPO terms</small>
              </label>
              <div className="text-input">
                <select
                  value={formParameters.exitStrategy}
                  onChange={(event) => updateParameters({ exitStrategy: event.target.value as SimulationParameters['exitStrategy'] })}
                >
                  <option value="ma">M&amp;A — escrow &amp; earn-out</option>
                  <option value="ipo">IPO — float &amp; lock-up</option>
                </select>
              </div>
            </div>
            <div className="controls-grid">
              <SliderInput
                label="Exit Month"
                description="Month when you plan to exit"
                min={0}
                max={formParameters.months}
                step={1}
                value={formParameters.exitMonth}
                onChange={(value) => updateParameters({ exitMonth: value })}
                format={(value) => `${value}`}
              />
              <SliderInput
                label="Valuation Multiple"
                description="Exit enterprise value as a multiple of ARR"
                min={0}
                max={20}
                step={0.5}
                value={formParameters.valuationMultiple}
                onChange={(value) => updateParameters({ valuationMultiple: value })}
                format={(value) => `${value.toFixed(1)}×`}
              />
              <SliderInput
                label={formParameters.exitStrategy === 'ma' ? 'Escrow Rate' : 'Float Percent'}
                description={
                  formParameters.exitStrategy === 'ma'
                    ? 'Percent of sale price held in escrow'
                    : 'Percent of shares sold in the IPO'
                }
                min={0}
                max={1}
                step={0.01}
                value={
                  formParameters.exitStrategy === 'ma'
                    ? Number(formParameters.escrowRate.toFixed(3))
                    : Number(formParameters.ipoFloatPercent.toFixed(3))
                }
                onChange={(value) =>
                  updateParameters(
                    formParameters.exitStrategy === 'ma'
                      ? { escrowRate: value }
                      : { ipoFloatPercent: value }
                  )
                }
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={0}
              />
              {formParameters.exitStrategy === 'ma' ? (
                <>
                  <SliderInput
                    label="Escrow Release (months)"
                    description="Months until escrow cash is paid out"
                    min={0}
                    max={36}
                    step={1}
                    value={formParameters.escrowMonths}
                    onChange={(value) => updateParameters({ escrowMonths: value })}
                    format={(value) => `${value}`}
                  />
                  <SliderInput
                    label="Earn-out Rate"
                    description="Percent of the deal tied to earn-out"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(formParameters.earnOutRate.toFixed(3))}
                    onChange={(value) => updateParameters({ earnOutRate: value })}
                    format={(value) => percentFormatter.format(value)}
                    inputScale={100}
                    inputPrecision={0}
                  />
                  <SliderInput
                    label="Earn-out Horizon"
                    description="Months until the earn-out check-in"
                    min={0}
                    max={48}
                    step={1}
                    value={formParameters.earnOutMonths}
                    onChange={(value) => updateParameters({ earnOutMonths: value })}
                    format={(value) => `${value}`}
                  />
                  <SliderInput
                    label="Earn-out Growth Target"
                    description="Growth rate needed for full earn-out"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(formParameters.earnOutGrowthTarget.toFixed(3))}
                    onChange={(value) => updateParameters({ earnOutGrowthTarget: value })}
                    format={(value) => percentFormatter.format(value)}
                    inputScale={100}
                    inputPrecision={0}
                  />
                </>
              ) : (
                <>
                  <SliderInput
                    label="Lock-up Months"
                    description="Months shares are locked before selling"
                    min={0}
                    max={24}
                    step={1}
                    value={formParameters.ipoLockupMonths}
                    onChange={(value) => updateParameters({ ipoLockupMonths: value })}
                    format={(value) => `${value}`}
                  />
                  <SliderInput
                    label="Post-lockup Sell-down"
                    description="Percent of remaining shares sold after lock-up"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(formParameters.postLockupSellDown.toFixed(3))}
                    onChange={(value) => updateParameters({ postLockupSellDown: value })}
                    format={(value) => percentFormatter.format(value)}
                    inputScale={100}
                    inputPrecision={0}
                  />
                  <SliderInput
                    label="IPO Discount"
                    description="Discount investors demand at IPO"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(formParameters.ipoDiscount.toFixed(3))}
                    onChange={(value) => updateParameters({ ipoDiscount: value })}
                    format={(value) => percentFormatter.format(value)}
                    inputScale={100}
                    inputPrecision={0}
                  />
                  <SliderInput
                    label="Underwriting Fees"
                    description="Bank and legal fees as percent of proceeds"
                    min={0}
                    max={1}
                    step={0.005}
                    value={Number(formParameters.ipoFeesRate.toFixed(3))}
                    onChange={(value) => updateParameters({ ipoFeesRate: value })}
                    format={(value) => percentFormatter.format(value)}
                    inputScale={100}
                    inputPrecision={1}
                  />
                </>
              )}
              <SliderInput
                label="Transaction Costs"
                description="Advisor and diligence costs as percent of price"
                min={0}
                max={1}
                step={0.005}
                value={Number(formParameters.transactionCostRate.toFixed(3))}
                onChange={(value) => updateParameters({ transactionCostRate: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={1}
              />
              <SliderInput
                label="Working Capital Adjustment"
                description="Net working capital adjustment at close"
                min={0}
                max={1}
                step={0.005}
                value={Number(formParameters.workingCapitalRate.toFixed(3))}
                onChange={(value) => updateParameters({ workingCapitalRate: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={1}
              />
            </div>
          </div>

          <div className="section">
            <h3>Policy &amp; Milestones</h3>
            <div className="controls-grid">
              <SliderInput
                label="Policy Band"
                description="Allowed drift from milestone plan (±%)"
                min={0}
                max={1}
                step={0.01}
                value={Number(formParameters.policyBand.toFixed(3))}
                onChange={(value) => updateParameters({ policyBand: value })}
                format={(value) => percentFormatter.format(value)}
                inputScale={100}
                inputPrecision={0}
              />
            </div>
            <div className="milestones">
              <label>Milestone Valuations</label>
              <div className="milestone-list">
                {formParameters.milestoneTargets.map((target, index) => (
                  <div key={index} className="milestone-item">
                    <input
                      type="number"
                      value={Math.round(target)}
                      onChange={(event) => handleMilestoneChange(index, Number(event.target.value))}
                      aria-label={`Milestone ${index + 1}`}
                    />
                    <span>{currencyFormatter.format(target)}</span>
                    {formParameters.milestoneTargets.length > 1 && (
                      <button type="button" onClick={() => removeMilestone(index)} aria-label="Remove milestone">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="link-button" onClick={addMilestone}>
                + Add milestone
              </button>
            </div>
          </div>

          <div className="section actions">
            <h3>Actions</h3>
            <div className="actions">
              <button type="button" onClick={runSimulation} disabled={isRunning}>
                {isRunning ? 'Running…' : 'Run Simulation'}
              </button>
              <button type="button" onClick={handleExport} disabled={isRunning}>
                Export Settings
              </button>
              <label>
                Import Settings
                <input type="file" accept="application/json" onChange={handleImport} />
              </label>
              {hasPendingChanges && !isRunning && (
                <span className="actions__status">Settings changed — run to refresh results</span>
              )}
            </div>
          </div>
        </section>

        <section className="chart-container" aria-live="polite">
          <h2>Forecast Outputs</h2>
          {isRunning && <p>Running simulation…</p>}
          {!isRunning && hasPendingChanges && result && (
            <p className="pending-notice">Settings have changed — run the simulation to refresh these results.</p>
          )}
          {!isRunning && result && (
            <>
              <div className="metrics-grid">
                <div className="metric-card primary">
                  <span>Policy Recommendation</span>
                  <strong>{result.policy.recommendedAction}</strong>
                  <small>{result.policy.notes[0]}</small>
                </div>
                <div className="metric-card">
                  <span>Total Sale Proceeds (median)</span>
                  <strong>{currencyFormatter.format(result.saleSummary.total.median)}</strong>
                  <small>
                    Immediate {currencyFormatter.format(result.saleSummary.immediate.median)} ·
                    Deferred {currencyFormatter.format(
                      result.saleSummary.escrow.median +
                        result.saleSummary.earnOut.median +
                        result.saleSummary.postLockup.median
                    )}
                  </small>
                </div>
                <div className="metric-card">
                  <span>LTV : CAC</span>
                  <strong>
                    {Number.isFinite(result.unitEconomics.ltvToCac)
                      ? ratioFormatter.format(result.unitEconomics.ltvToCac)
                      : '∞'}
                  </strong>
                  <small>
                    Payback {Number.isFinite(result.unitEconomics.cacPaybackMonths)
                      ? `${ratioFormatter.format(result.unitEconomics.cacPaybackMonths)} months`
                      : 'n/a'}
                  </small>
                </div>
                <div className="metric-card">
                  <span>Treasury @ horizon</span>
                  <strong>
                    {currencyFormatter.format(
                      result.summary[result.summary.length - 1]?.medianTreasury ?? 0
                    )}
                  </strong>
                  <small>
                    Liquid cash{' '}
                    {currencyFormatter.format(
                      result.summary[result.summary.length - 1]?.medianLiquidCash ?? 0
                    )}
                  </small>
                </div>
              </div>

              <div className="policy-table">
                <h3>Milestone Tracking</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Achieved</th>
                      <th>Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.policy.milestones.map((milestone, index) => (
                      <tr key={index}>
                        <td>{currencyFormatter.format(milestone.target)}</td>
                        <td>{renderPolicyBadge(milestone)}</td>
                        <td>{milestone.achievedMonth ? `Month ${milestone.achievedMonth}` : '—'}</td>
                        <td>Month {milestone.expectedMonth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sale-summary">
                <h3>Exit Proceeds Breakdown</h3>
                <div className="summary-grid">
                  <div>
                    <span>Immediate</span>
                    <strong>{currencyFormatter.format(result.saleSummary.immediate.median)}</strong>
                  </div>
                  <div>
                    <span>Escrow / Deferred</span>
                    <strong>
                      {currencyFormatter.format(
                        result.saleSummary.escrow.median + result.saleSummary.earnOut.median
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Post-lockup</span>
                    <strong>{currencyFormatter.format(result.saleSummary.postLockup.median)}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{currencyFormatter.format(result.saleSummary.total.median)}</strong>
                  </div>
                </div>
              </div>

              <div className="chart-wrapper">
                {mrrChartData && (
                  <Line
                    data={mrrChartData}
                    options={{
                      responsive: true,
                      interaction: { mode: 'index', intersect: false },
                      plugins: {
                        legend: { position: 'bottom' as const },
                      },
                      scales: {
                        y: {
                          ticks: {
                            callback: (value) => currencyFormatter.format(Number(value)),
                          },
                        },
                      },
                    }}
                  />
                )}
              </div>

              <div className="chart-wrapper">
                {valuationData && (
                  <Line
                    data={valuationData}
                    options={{
                      responsive: true,
                      interaction: { mode: 'index', intersect: false },
                      plugins: { legend: { position: 'bottom' as const } },
                      scales: {
                        y: {
                          ticks: {
                            callback: (value) => currencyFormatter.format(Number(value)),
                          },
                        },
                        ratio: {
                          position: 'right' as const,
                          grid: { drawOnChartArea: false },
                          min: 0,
                          ticks: {
                            callback: (value) => `${ratioFormatter.format(Number(value))}×`,
                          },
                        },
                      },
                    }}
                  />
                )}
              </div>

              <div className="chart-wrapper">
                {liquidityData && (
                  <Line
                    data={liquidityData}
                    options={{
                      responsive: true,
                      interaction: { mode: 'index', intersect: false },
                      plugins: { legend: { position: 'bottom' as const } },
                      scales: {
                        y: {
                          ticks: {
                            callback: (value) => currencyFormatter.format(Number(value)),
                          },
                        },
                        economics: {
                          position: 'right' as const,
                          grid: { drawOnChartArea: false },
                          ticks: {
                            callback: (value) => `${ratioFormatter.format(Number(value))} mo`,
                          },
                        },
                      },
                    }}
                  />
                )}
              </div>

              <div className="notes">
                {result.policy.notes.slice(1).map((note, index) => (
                  <p key={index}>{note}</p>
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      <footer>
        Monte Carlo engine runs locally with seeded randomness for reproducibility. Export scenarios as
        JSON to collaborate without a backend. Install the PWA to work completely offline.
      </footer>
    </div>
  );
};

export default App;
