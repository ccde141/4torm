/** Restore the desktop server once after an unexpected exit; never replay work. */
function createServerRecovery({ recover, onFailure }) {
  let stopping = false;
  let attempted = false;
  return {
    stop() { stopping = true; },
    async handleExit() {
      if (stopping || attempted) return;
      attempted = true;
      try { await recover(); }
      catch (error) { onFailure(error); }
    },
  };
}

module.exports = { createServerRecovery };
