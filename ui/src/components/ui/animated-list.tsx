import { AnimatePresence, type MotionProps, motion } from "framer-motion";
import {
  Children,
  type ComponentPropsWithoutRef,
  memo,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const itemAnimation: MotionProps = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1, originY: 0 },
  exit: { scale: 0, opacity: 0 },
  transition: { type: "spring", stiffness: 350, damping: 40 },
};

export function AnimatedListItem({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <motion.div ref={ref} {...itemAnimation} layout className="mx-auto w-full">
      {children}
    </motion.div>
  );
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  delay?: number;
}

export const AnimatedList = memo(function AnimatedList({
  children,
  className,
  delay = 1000,
  ...props
}: AnimatedListProps) {
  const [index, setIndex] = useState(0);
  const childrenArray = useMemo(() => Children.toArray(children), [children]);

  useEffect(() => {
    if (index >= childrenArray.length - 1) return;
    const timeout = setTimeout(() => setIndex((value) => value + 1), delay);
    return () => clearTimeout(timeout);
  }, [index, delay, childrenArray.length]);

  const itemsToShow = useMemo(
    () => childrenArray.slice(0, index + 1).reverse(),
    [index, childrenArray],
  );

  return (
    <div className={cn("flex flex-col items-center gap-4", className)} {...props}>
      <AnimatePresence>
        {itemsToShow.map((item) => (
          <AnimatedListItem key={(item as ReactElement).key}>{item}</AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
});
