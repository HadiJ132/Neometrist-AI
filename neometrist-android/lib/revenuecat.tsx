import React, { createContext, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import type { PlanTier } from '@/lib/physicsEngine';

// Test Store is the only configured purchase path for this build. The Android
// and iOS store keys are intentionally not read, so preview/test purchases
// cannot accidentally route through a platform store configuration.
const testKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
export const PREMIUM_ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? 'premium';
export const PROMIUM_ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_PROMIUM_ENTITLEMENT ?? 'promium_tier';
const promiumProductId = process.env.EXPO_PUBLIC_REVENUECAT_PROMIUM_PRODUCT_ID ?? 'neometrist_promium_monthly';
const premiumProductId = process.env.EXPO_PUBLIC_REVENUECAT_PREMIUM_PRODUCT_ID ?? 'neometrist_premium_monthly';
const promiumPackageId = process.env.EXPO_PUBLIC_REVENUECAT_PROMIUM_PACKAGE_ID;
const premiumPackageId = process.env.EXPO_PUBLIC_REVENUECAT_PREMIUM_PACKAGE_ID;
const premiumEntitlementKeys = [PREMIUM_ENTITLEMENT, 'premium'];
const promiumEntitlementKeys = [PROMIUM_ENTITLEMENT, 'promium_tier'];

let configured = false;

export function initializeRevenueCat() {
  if (!testKey) return false;
  Purchases.setLogLevel(Purchases.LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: testKey });
  configured = true;
  return true;
}

function useRevenueCatQueries() {
  const queryClient = useQueryClient();
  const customerInfoQuery = useQuery({
    queryKey: ['revenuecat', 'customer-info'],
    queryFn: () => Purchases.getCustomerInfo(),
    enabled: configured,
    staleTime: 60_000,
  });
  const offeringsQuery = useQuery({
    queryKey: ['revenuecat', 'offerings'],
    queryFn: () => Purchases.getOfferings(),
    enabled: configured,
    staleTime: 300_000,
  });
  const purchaseMutation = useMutation({
    mutationFn: (packageToPurchase: PurchasesPackage) => Purchases.purchasePackage(packageToPurchase),
    onSuccess: async ({ customerInfo }) => {
      queryClient.setQueryData(['revenuecat', 'customer-info'], customerInfo);
      await customerInfoQuery.refetch();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
    onSuccess: async (customerInfo) => {
      queryClient.setQueryData(['revenuecat', 'customer-info'], customerInfo);
      await customerInfoQuery.refetch();
    },
  });
  const activeEntitlements = customerInfoQuery.data?.entitlements?.active ?? {};
  const currentOffering = offeringsQuery.data?.current;
  const isPremium = premiumEntitlementKeys.some((key) => Boolean(activeEntitlements[key]));
  const isPromium = promiumEntitlementKeys.some((key) => Boolean(activeEntitlements[key]));
  const planTier: PlanTier = isPremium ? 'premium' : isPromium ? 'promium' : 'freemium';

  const packageForTier = (tier: Exclude<PlanTier, 'freemium'>): PurchasesPackage | undefined => {
    const preferredId = tier === 'premium' ? premiumProductId : promiumProductId;
    const packageId = tier === 'premium' ? premiumPackageId : promiumPackageId;
    const packages = currentOffering?.availablePackages ?? [];
    const productIds = tier === 'premium'
      ? [preferredId, 'neometrist_premium_monthly', 'neometrist_premium_monthly:monthly']
      : [preferredId, 'neometrist_promium_monthly', 'neometrist_promium_monthly:monthly'];
    const expectedProductIds = new Set(productIds.map((value) => value.trim().toLowerCase()));
    const expectedPackageId = packageId?.trim().toLowerCase();
    return packages.find((item: any) => {
      const productIdentifier = String(item.product?.identifier ?? '').trim().toLowerCase();
      const packageIdentifier = String(item.identifier ?? '').trim().toLowerCase();
      return expectedProductIds.has(productIdentifier) ||
        (Boolean(expectedPackageId) && packageIdentifier === expectedPackageId);
    });
  };

  const priceForTier = (tier: Exclude<PlanTier, 'freemium'>) =>
    packageForTier(tier)?.product?.priceString ?? 'Unavailable';

  const isTierAvailable = (tier: Exclude<PlanTier, 'freemium'>) =>
    configured && Boolean(packageForTier(tier));
  const billingError = offeringsQuery.error instanceof Error
    ? offeringsQuery.error.message
    : customerInfoQuery.error instanceof Error
      ? customerInfoQuery.error.message
      : undefined;

  return {
    configured,
    offerings: currentOffering,
    planTier,
    isPremium,
    isPromium,
    isSubscribed: isPremium,
    priceForTier,
    packageForTier,
    isTierAvailable,
    billingError,
    isLoading: configured && (customerInfoQuery.isLoading || offeringsQuery.isLoading),
    purchase: purchaseMutation.mutateAsync,
    purchaseTier: async (tier: Exclude<PlanTier, 'freemium'>) => {
      if (!configured) {
        throw new Error('RevenueCat is not initialized. Check the Test Store public key in the app configuration.');
      }
      const packageToPurchase = packageForTier(tier);
      if (!packageToPurchase) throw new Error(`${tier === 'promium' ? 'Promium' : 'Premium'} is not available in the current subscription catalog.`);
      return purchaseMutation.mutateAsync(packageToPurchase);
    },
    restore: async () => {
      if (!configured) throw new Error('RevenueCat is not initialized, so purchases cannot be restored yet.');
      return restoreMutation.mutateAsync();
    },
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
  };
}

type SubscriptionContextValue = ReturnType<typeof useRevenueCatQueries>;
const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useRevenueCatQueries();
  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error('useSubscription must be used inside SubscriptionProvider.');
  return useMemo(() => context, [context]);
}
