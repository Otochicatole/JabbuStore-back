import fs from 'fs';

function main() {
  const data = JSON.parse(fs.readFileSync('steamwebapi-json-data/market-assets-checkpoint.json', 'utf8'));
  console.log(`CursorIndex: ${data.cursorIndex}`);
  console.log(`CandidatesVisited: ${data.candidatesVisited}`);
  
  // We need to look up candidates by index to match their keys
  // Wait, the checkpoint file doesn't store the candidates list directly, but we can load it using the catalog or priority queue builder
  // Wait, let's just find progress entries that have been modified recently or have pageRequests > 0 and let's print their key and values
  // Wait! In our current execution, did any candidate get pageRequests > 0?
  // Let's check candidate progress keys.
  const progressMap = data.candidateProgress;
  const entries = Object.entries(progressMap).map(([key, value]: [string, any]) => ({ key, ...value }));
  
  // Wait, how do we know if a candidate was visited in our current run?
  // Candidates that are completed: true, exhausted: true, and have pageRequests: 0!
  // Ah! Candidates skipped by our activeSet filter will have: completed: true, exhausted: true, pageRequests: 0!
  // Candidates that were queried by our current run will have pageRequests > 0, and their key was not in the previous run's completed list.
  // Wait, let's look at the ones with pageRequests === 0 and completed === true!
  const skipped = entries.filter((c: any) => c.completed && c.pageRequests === 0);
  console.log(`Candidates skipped (completed with 0 pageRequests): ${skipped.length}`);
  if (skipped.length > 0) {
    console.log('Sample skipped:', skipped.slice(0, 5).map((c: any) => c.key));
  }
}

main();
