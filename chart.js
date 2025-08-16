/**
 * Renders a line chart of hip height over time.
 * @param {HTMLCanvasElement} canvas The canvas element to draw the chart on.
 * @param {number[]} data An array of hip Y-coordinates.
 * @returns {Chart} The Chart.js instance.
 */
export function renderHipHeightChart(canvas, data) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  const chartConfig = {
    type: 'line',
    data: {
      labels: data.map((_, index) => index), // Use frame numbers as labels
      datasets: [{
        label: 'Hip Height',
        data: data,
        borderColor: '#00CFFF',
        backgroundColor: 'rgba(0, 207, 255, 0.1)',
        fill: true,
        tension: 0.4, // Smoothes the line
        pointRadius: 0 // Hide individual points
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        title: {
            display: true,
            text: 'Hip Height Over Time',
            color: '#e0e0e0',
            font: {
                family: "'Roboto Mono', monospace",
                size: 16
            }
        }
      },
      scales: {
        y: {
          reverse: true, // In screen coordinates, lower y is a higher value
          title: {
            display: true,
            text: 'Vertical Position (Lower is Deeper)',
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: {
            color: '#333333'
          },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        x: {
          title: {
            display: true,
            text: 'Time (Frames)',
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: {
            color: '#333333'
          },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        }
      }
    }
  };

  return new Chart(ctx, chartConfig);
}