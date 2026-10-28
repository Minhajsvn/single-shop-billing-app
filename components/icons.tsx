"use client";

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Archive01Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  BarCode01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CashierIcon,
  ChartHistogramIcon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CreditCardIcon,
  Delete02Icon,
  Download04Icon,
  FileUploadIcon,
  Home01Icon,
  HourglassIcon,
  IdIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Key01Icon,
  LockIcon,
  Login01Icon,
  Logout01Icon,
  Mail01Icon,
  MinusSignIcon,
  Money03Icon,
  MoreHorizontalIcon,
  PauseCircleIcon,
  Pdf01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  PrinterIcon,
  RefreshIcon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  ShieldCheckIcon,
  ShoppingCart01Icon,
  SparklesIcon,
  SquareLock02Icon,
  Store01Icon,
  Tag01Icon,
  Upload04Icon,
  UserAdd01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";

/*
 * Hugeicons behind the icon names and props the app already uses (size, weight, className),
 * so call sites stay unchanged. The free set is outline-only, so `weight` becomes stroke width:
 * "fill" marks an active or primary icon with a heavier stroke.
 */
export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
export type IconProps = { size?: number | string; weight?: IconWeight; className?: string };
export type Icon = (props: IconProps) => React.ReactElement;

const STROKE: Record<IconWeight, number> = { thin: 1.2, light: 1.4, regular: 1.6, duotone: 1.6, bold: 1.8, fill: 2.2 };

function make(icon: IconSvgElement): Icon {
  function HugeIcon({ size = 16, weight = "regular", className }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={STROKE[weight]} color="currentColor" className={className} aria-hidden="true" focusable="false" />;
  }
  return HugeIcon;
}

export const Archive = make(Archive01Icon);
export const ArrowClockwise = make(ArrowReloadHorizontalIcon);
export const ArrowCounterClockwise = make(ArrowTurnBackwardIcon);
export const ArrowLeft = make(ArrowLeft01Icon);
export const ArrowsClockwise = make(RefreshIcon);
export const Barcode = make(BarCode01Icon);
export const CalendarBlank = make(Calendar03Icon);
export const CaretUp = make(ArrowUp01Icon);
export const CashRegister = make(CashierIcon);
export const ChartBar = make(ChartHistogramIcon);
export const CheckCircle = make(CheckmarkCircle02Icon);
export const ClockCounterClockwise = make(Clock01Icon);
export const CreditCard = make(CreditCardIcon);
export const DotsThreeOutline = make(MoreHorizontalIcon);
export const DownloadSimple = make(Download04Icon);
export const EnvelopeSimple = make(Mail01Icon);
export const FileArrowUp = make(FileUploadIcon);
export const FilePdf = make(Pdf01Icon);
export const Gear = make(Settings01Icon);
export const House = make(Home01Icon);
export const HourglassMedium = make(HourglassIcon);
export const IdentificationCard = make(IdIcon);
export const Info = make(InformationCircleIcon);
export const Key = make(Key01Icon);
export const ListChecks = make(CheckListIcon);
export const LockKey = make(SquareLock02Icon);
export const LockSimple = make(LockIcon);
export const MagnifyingGlass = make(Search01Icon);
export const Minus = make(MinusSignIcon);
export const Money = make(Money03Icon);
export const PaperPlaneTilt = make(SentIcon);
export const PauseCircle = make(PauseCircleIcon);
export const PencilSimple = make(PencilEdit01Icon);
export const Plus = make(PlusSignIcon);
export const Printer = make(PrinterIcon);
export const Receipt = make(Invoice01Icon);
export const ShieldCheck = make(ShieldCheckIcon);
export const ShoppingCart = make(ShoppingCart01Icon);
export const SignIn = make(Login01Icon);
export const SignOut = make(Logout01Icon);
export const Sparkle = make(SparklesIcon);
export const Storefront = make(Store01Icon);
export const Tag = make(Tag01Icon);
export const Trash = make(Delete02Icon);
export const UploadSimple = make(Upload04Icon);
export const User = make(UserIcon);
export const UserPlus = make(UserAdd01Icon);
export const WarningCircle = make(AlertCircleIcon);
export const X = make(Cancel01Icon);
