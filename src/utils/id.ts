export function generateNextId(prefix: string, existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const num = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(num) && num > max) {
        max = num;
      }
    }
  }
  return `${prefix}${(max + 1).toString().padStart(6, "0")}`;
}
