// Export a variable to hold the latest pose
export let latestPose = null;

// Export a function to update it
export function updatePose(data) {
  latestPose = data;
}