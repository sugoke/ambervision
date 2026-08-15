import {
  StatusBlock, UnderlyingsBlock, ChartBlock, ScheduleBlock, CouponsBlock,
  BarrierBlock, StateRegistersBlock, AccumulatorsBlock, PayoffBlock,
  IssuesBlock, JsonDefinitionBlock
} from './blocks.jsx';

/**
 * blockType -> component. The report document decides which blocks exist and
 * in what order; unknown types render nothing (forward compatibility).
 */
export const BLOCK_REGISTRY = {
  status: StatusBlock,
  underlyings: UnderlyingsBlock,
  chart: ChartBlock,
  schedule: ScheduleBlock,
  coupons: CouponsBlock,
  barrier: BarrierBlock,
  stateRegisters: StateRegistersBlock,
  accumulators: AccumulatorsBlock,
  payoff: PayoffBlock,
  issues: IssuesBlock,
  jsonDefinition: JsonDefinitionBlock
};
