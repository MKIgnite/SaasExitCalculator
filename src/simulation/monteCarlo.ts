import { createRng, sampleBeta, sampleLogNormal } from './random';

export type ExitStrategy = 'ma' | 'ipo';

export interface SimulationParameters {
  months: number;
  trials: number;
  seed: string;
  initialMrr: number;
  baseGrowthMean: number; // monthly growth mean in decimal
  growthVolatility: number; // sigma for lognormal
  churnAlpha: number;
  churnBeta: number;
  arpu: number;
  valuationMultiple: number;
  profitTakeRate: number; // % of gross profit to move into savings
  grossMargin: number; // decimal
  exitStrategy: ExitStrategy;
  exitMonth: number;
  escrowRate: number;
  escrowMonths: number;
  earnOutRate: number;
  earnOutMonths: number;
  earnOutGrowthTarget: number;
  transactionCostRate: number;
  workingCapitalRate: number;
  ipoFloatPercent: number;
  ipoDiscount: number;
  ipoFeesRate: number;
  ipoLockupMonths: number;
  postLockupSellDown: number;
  policyBand: number;
  milestoneTargets: number[];
  customerAcquisitionCost: number;
}

export interface SimulationSeries {
  month: number;
  median: number;
  p10: number;
  p90: number;
}

export interface SummaryEntry {
  month: number;
  medianArr: number;
  medianValuation: number;
  medianTreasury: number;
  medianLiquidCash: number;
}

export interface ProceedsStat {
  median: number;
  p10: number;
  p90: number;
}

export interface SaleProceedsSummary {
  strategy: ExitStrategy;
  exitMonth: number;
  immediate: ProceedsStat;
  escrow: ProceedsStat;
  earnOut: ProceedsStat;
  postLockup: ProceedsStat;
  total: ProceedsStat;
}

export type PolicyStatus = 'ahead' | 'on_track' | 'behind' | 'missed';

export interface PolicyMilestone {
  target: number;
  achievedMonth: number | null;
  expectedMonth: number;
  status: PolicyStatus;
}

export interface PolicyResult {
  recommendedAction: 'SELL' | 'PREPARE' | 'HOLD';
  policyBand: number;
  exitValuation: number;
  nextMilestone: PolicyMilestone | null;
  milestones: PolicyMilestone[];
  notes: string[];
}

export interface UnitEconomics {
  expectedChurn: number;
  ltv: number;
  cac: number;
  ltvToCac: number;
  cacPaybackMonths: number;
}

export interface SimulationResult {
  mrr: SimulationSeries[];
  arr: SimulationSeries[];
  valuation: SimulationSeries[];
  treasury: SimulationSeries[];
  liquidCash: SimulationSeries[];
  summary: SummaryEntry[];
  saleSummary: SaleProceedsSummary;
  policy: PolicyResult;
  unitEconomics: UnitEconomics;
}

interface ScheduledProceeds {
  month: number;
  amount: number;
  type: 'escrow' | 'earnOut' | 'lockup';
}

interface SaleComputationResult {
  immediate: number;
  scheduled: ScheduledProceeds[];
}

const percentile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
};

const computeMaProceeds = (
  valuation: number,
  params: SimulationParameters,
  yearAgoMrr: number,
  currentMrr: number
): SaleComputationResult => {
  const grossSale = valuation;
  const netAfterCosts = Math.max(
    0,
    grossSale * (1 - params.transactionCostRate) - grossSale * params.workingCapitalRate
  );
  const escrow = netAfterCosts * params.escrowRate;
  const baseEarnOut = netAfterCosts * params.earnOutRate;
  const immediate = Math.max(netAfterCosts - escrow - baseEarnOut, 0);

  const growthDenominator = yearAgoMrr <= 0 ? currentMrr : yearAgoMrr;
  const growth = growthDenominator === 0 ? 0 : (currentMrr - growthDenominator) / growthDenominator;
  const earnOutMultiplier = params.earnOutGrowthTarget <= 0 ? 1 : Math.max(
    0,
    Math.min(growth / params.earnOutGrowthTarget, 1.25)
  );
  const earnOut = baseEarnOut * earnOutMultiplier;

  const scheduled: ScheduledProceeds[] = [];
  if (escrow > 0) {
    scheduled.push({
      month: params.exitMonth - 1 + params.escrowMonths,
      amount: escrow,
      type: 'escrow',
    });
  }
  if (earnOut > 0) {
    scheduled.push({
      month: params.exitMonth - 1 + params.earnOutMonths,
      amount: earnOut,
      type: 'earnOut',
    });
  }

  return {
    immediate,
    scheduled,
  };
};

const computeIpoProceeds = (
  valuation: number,
  params: SimulationParameters
): SaleComputationResult => {
  const discountedValuation = valuation * (1 - params.ipoDiscount);
  const floatGross = discountedValuation * params.ipoFloatPercent;
  const immediate = floatGross * (1 - params.ipoFeesRate);

  const remainingEquity = Math.max(discountedValuation - floatGross, 0);
  const lockup = remainingEquity * params.postLockupSellDown * (1 - params.ipoFeesRate);

  const scheduled: ScheduledProceeds[] = [];
  if (lockup > 0) {
    scheduled.push({
      month: params.exitMonth - 1 + params.ipoLockupMonths,
      amount: lockup,
      type: 'lockup',
    });
  }

  return {
    immediate,
    scheduled,
  };
};

const buildPolicy = (
  params: SimulationParameters,
  valuationSeries: SimulationSeries[]
): PolicyResult => {
  const { policyBand, milestoneTargets, months, exitMonth } = params;
  const exitValuation = valuationSeries[Math.max(0, exitMonth - 1)]?.median ?? 0;

  const milestones: PolicyMilestone[] = milestoneTargets.map((target, index) => {
    const hit = valuationSeries.find((point) => point.median >= target);
    const achievedMonth = hit ? hit.month : null;
    const expectedMonth = Math.max(
      1,
      Math.round(((index + 1) / (milestoneTargets.length + 1)) * months)
    );
    let status: PolicyStatus = 'missed';
    if (achievedMonth) {
      const ratio = achievedMonth / expectedMonth;
      if (ratio <= 1 - policyBand) {
        status = 'ahead';
      } else if (ratio <= 1 + policyBand) {
        status = 'on_track';
      } else {
        status = 'behind';
      }
    }
    return { target, achievedMonth, expectedMonth, status };
  });

  const nextMilestone = milestones.find((milestone) => milestone.achievedMonth === null);

  let recommendedAction: PolicyResult['recommendedAction'] = 'HOLD';
  if (!nextMilestone) {
    recommendedAction = 'SELL';
  } else {
    const guardrail = nextMilestone.target * (1 - policyBand);
    if (exitValuation >= guardrail) {
      recommendedAction = 'PREPARE';
    }
  }

  const notes: string[] = [];
  notes.push(
    `Exit valuation at month ${exitMonth}: $${exitValuation.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`
  );
  milestones.forEach((milestone) => {
    if (milestone.achievedMonth) {
      notes.push(
        `Milestone $${milestone.target.toLocaleString()} reached in month ${milestone.achievedMonth} (${milestone.status.replace(
          '_',
          ' '
        )}).`
      );
    } else {
      notes.push(
        `Milestone $${milestone.target.toLocaleString()} not yet reached; expected around month ${milestone.expectedMonth}.`
      );
    }
  });

  return {
    recommendedAction,
    policyBand,
    exitValuation,
    nextMilestone: nextMilestone ?? null,
    milestones,
    notes,
  };
};

const buildUnitEconomics = (params: SimulationParameters): UnitEconomics => {
  const expectedChurn = params.churnAlpha / (params.churnAlpha + params.churnBeta);
  const grossMarginRevenue = params.arpu * params.grossMargin;
  const ltv = expectedChurn > 0 ? grossMarginRevenue / expectedChurn : Infinity;
  const cac = params.customerAcquisitionCost;
  const ltvToCac = cac > 0 ? ltv / cac : Infinity;
  const cacPaybackMonths = grossMarginRevenue > 0 ? cac / grossMarginRevenue : Infinity;

  return {
    expectedChurn,
    ltv,
    cac,
    ltvToCac,
    cacPaybackMonths,
  };
};

export const runSimulation = (params: SimulationParameters): SimulationResult => {
  const {
    months,
    trials,
    seed,
    initialMrr,
    baseGrowthMean,
    growthVolatility,
    churnAlpha,
    churnBeta,
    arpu,
    valuationMultiple,
    profitTakeRate,
    grossMargin,
    exitStrategy,
  } = params;

  const mrrPaths: number[][] = Array.from({ length: trials }, () => new Array(months).fill(0));
  const valuationPaths: number[][] = Array.from({ length: trials }, () => new Array(months).fill(0));
  const treasuryPaths: number[][] = Array.from({ length: trials }, () => new Array(months).fill(0));
  const liquidCashPaths: number[][] = Array.from({ length: trials }, () => new Array(months).fill(0));

  const immediateProceeds: number[] = [];
  const escrowProceeds: number[] = [];
  const earnOutProceeds: number[] = [];
  const lockupProceeds: number[] = [];
  const totalProceeds: number[] = [];

  for (let trial = 0; trial < trials; trial++) {
    const rng = createRng(`${seed}-${trial}`);
    let customers = Math.max(initialMrr / Math.max(arpu, 1e-6), 1);
    let mrr = initialMrr;
    let treasury = 0;
    let proceedsReceived = 0;
    const scheduled: Record<number, ScheduledProceeds[]> = {};

    let immediate = 0;
    let escrowTotal = 0;
    let earnOutTotal = 0;
    let lockupTotal = 0;
    let futureEscrow = 0;
    let futureEarnOut = 0;
    let futureLockup = 0;

    for (let month = 0; month < months; month++) {
      const monthIndex = month + 1;

      const due = scheduled[month] ?? [];
      let proceedsThisMonth = 0;
      if (due.length > 0) {
        for (const item of due) {
          proceedsThisMonth += item.amount;
          switch (item.type) {
            case 'escrow':
              escrowTotal += item.amount;
              break;
            case 'earnOut':
              earnOutTotal += item.amount;
              break;
            case 'lockup':
              lockupTotal += item.amount;
              break;
          }
        }
        delete scheduled[month];
      }

      const growthFactor = sampleLogNormal(rng, Math.log(1 + baseGrowthMean), growthVolatility);
      const churnRate = sampleBeta(rng, churnAlpha, churnBeta);

      const survivingCustomers = customers * (1 - churnRate);
      const expandedCustomers = survivingCustomers * (growthFactor - 1);
      customers = Math.max(survivingCustomers + expandedCustomers, 0);
      mrr = customers * arpu;

      const grossProfit = mrr * grossMargin;
      treasury += grossProfit * profitTakeRate;
      proceedsReceived += proceedsThisMonth;

      const valuation = mrr * 12 * valuationMultiple;

      if (monthIndex === params.exitMonth) {
        const yearAgoIndex = month - 12;
        const yearAgoMrr = yearAgoIndex >= 0 ? mrrPaths[trial][yearAgoIndex] : initialMrr;

        const saleResult =
          exitStrategy === 'ma'
            ? computeMaProceeds(valuation, params, yearAgoMrr, mrr)
            : computeIpoProceeds(valuation, params);

        immediate = saleResult.immediate;
        if (immediate > 0) {
          proceedsReceived += immediate;
        }

        for (const item of saleResult.scheduled) {
          if (item.month < months) {
            if (!scheduled[item.month]) {
              scheduled[item.month] = [];
            }
            scheduled[item.month].push(item);
          } else {
            switch (item.type) {
              case 'escrow':
                futureEscrow += item.amount;
                break;
              case 'earnOut':
                futureEarnOut += item.amount;
                break;
              case 'lockup':
                futureLockup += item.amount;
                break;
            }
          }
        }
      }

      mrrPaths[trial][month] = mrr;
      valuationPaths[trial][month] = valuation;
      treasuryPaths[trial][month] = treasury;
      liquidCashPaths[trial][month] = treasury + proceedsReceived;
    }

    // apply scheduled events that land beyond horizon to last month for liquid cash visibility
    const finalIndex = months - 1;
    if (futureEscrow + futureEarnOut + futureLockup > 0) {
      liquidCashPaths[trial][finalIndex] += futureEscrow + futureEarnOut + futureLockup;
    }

    const totalEscrow = escrowTotal + futureEscrow;
    const totalEarnOut = earnOutTotal + futureEarnOut;
    const totalLockup = lockupTotal + futureLockup;
    const total = immediate + totalEscrow + totalEarnOut + totalLockup;

    immediateProceeds.push(immediate);
    escrowProceeds.push(totalEscrow);
    earnOutProceeds.push(totalEarnOut);
    lockupProceeds.push(totalLockup);
    totalProceeds.push(total);
  }

  const buildSeries = (paths: number[][]): SimulationSeries[] => {
    const series: SimulationSeries[] = [];
    for (let month = 0; month < months; month++) {
      const monthIndex = month + 1;
      const slice = paths.map((trial) => trial[month]);
      series.push({
        month: monthIndex,
        median: percentile(slice, 0.5),
        p10: percentile(slice, 0.1),
        p90: percentile(slice, 0.9),
      });
    }
    return series;
  };

  const mrrSeries = buildSeries(mrrPaths);
  const valuationSeries = buildSeries(valuationPaths);
  const treasurySeries = buildSeries(treasuryPaths);
  const liquidCashSeries = buildSeries(liquidCashPaths);

  const arrSeries: SimulationSeries[] = mrrSeries.map((point) => ({
    month: point.month,
    median: point.median * 12,
    p10: point.p10 * 12,
    p90: point.p90 * 12,
  }));

  const summary: SummaryEntry[] = [];
  for (let month = 0; month < months; month++) {
    const monthIndex = month + 1;
    if (monthIndex % 12 === 0 || monthIndex === months) {
      summary.push({
        month: monthIndex,
        medianArr: arrSeries[month].median,
        medianValuation: valuationSeries[month].median,
        medianTreasury: treasurySeries[month].median,
        medianLiquidCash: liquidCashSeries[month].median,
      });
    }
  }

  const makeProceedsStat = (values: number[]): ProceedsStat => ({
    median: percentile(values, 0.5),
    p10: percentile(values, 0.1),
    p90: percentile(values, 0.9),
  });

  const saleSummary: SaleProceedsSummary = {
    strategy: exitStrategy,
    exitMonth: params.exitMonth,
    immediate: makeProceedsStat(immediateProceeds),
    escrow: makeProceedsStat(escrowProceeds),
    earnOut: makeProceedsStat(earnOutProceeds),
    postLockup: makeProceedsStat(lockupProceeds),
    total: makeProceedsStat(totalProceeds),
  };

  const policy = buildPolicy(params, valuationSeries);
  const unitEconomics = buildUnitEconomics(params);

  return {
    mrr: mrrSeries,
    arr: arrSeries,
    valuation: valuationSeries,
    treasury: treasurySeries,
    liquidCash: liquidCashSeries,
    summary,
    saleSummary,
    policy,
    unitEconomics,
  };
};
