export const FEMALE_SHOE_SIZES = ["37", "38", "39", "40", "41"] as const;
export const MALE_SHOE_SIZES = ["40", "41", "42", "43", "44", "45"] as const;

export function isFashionShoeContext(departmentName?: string | null, categoryName?: string | null) {
  const department = (departmentName ?? "").toLowerCase();
  const category = (categoryName ?? "").toLowerCase();
  const fashionDepartment = department.includes("fashion");
  const shoeCategory = category.includes("shoe");
  return fashionDepartment && shoeCategory;
}

export function quickShoeSizes(gender: string) {
  if (gender === "WOMEN") return [...FEMALE_SHOE_SIZES];
  if (gender === "MEN") return [...MALE_SHOE_SIZES];
  return [];
}
