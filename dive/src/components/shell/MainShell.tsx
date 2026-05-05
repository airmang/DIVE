import { ProductShellLayout } from "../product/ProductShellLayout";
import { useProductShellController } from "../product/useProductShellController";

export function MainShell() {
  const shell = useProductShellController();
  return <ProductShellLayout shell={shell} />;
}

export default MainShell;
