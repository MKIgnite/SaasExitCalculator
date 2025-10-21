import { runSimulation, SimulationParameters, SimulationResult } from '../simulation/monteCarlo';

export interface SimulationWorkerRequest {
  type: 'run';
  requestId: number;
  payload: SimulationParameters;
}

export interface SimulationWorkerResponse {
  requestId: number;
  result: SimulationResult;
}

self.addEventListener('message', (event: MessageEvent<SimulationWorkerRequest>) => {
  if (event.data?.type === 'run') {
    const result = runSimulation(event.data.payload);
    const response: SimulationWorkerResponse = {
      requestId: event.data.requestId,
      result,
    };
    (self as unknown as Worker)['postMessage'](response);
  }
});

export default null;
