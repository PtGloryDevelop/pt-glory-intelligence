/** Keep selected observations when filters or result pages change. */
export function toggleComparison<T extends { ad_archive_id: string }>(selected: T[], ad: T): T[] {
  if (selected.some((row) => row.ad_archive_id === ad.ad_archive_id)) {
    return selected.filter((row) => row.ad_archive_id !== ad.ad_archive_id);
  }
  return selected.length < 4 ? [...selected, ad] : selected;
}
